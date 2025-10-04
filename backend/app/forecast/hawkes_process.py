import math
from typing import List, Tuple
from dataclasses import dataclass
import numpy as np
from scipy.optimize import minimize

@dataclass
class HawkesParams:
    mu: float
    beta: float
    n_br: float  # branching ratio in (0,1); alpha = n_br * beta
    mu_std: float = 0.0  # uncertainty estimates
    beta_std: float = 0.0
    n_br_std: float = 0.0
    
    @property
    def alpha(self): return self.n_br * self.beta

def _expand_times(times: List[float], counts: List[int]) -> np.ndarray:
    expanded = []
    for t, c in zip(times, counts):
        expanded.extend([t] * int(max(1, c)))
    return np.array(expanded, dtype=float)

def _nll(theta: np.ndarray, t: np.ndarray, T: float) -> float:
    log_mu, log_beta, gamma = theta
    
    # Add bounds to prevent overflow
    log_mu = max(-10, min(10, log_mu))
    log_beta = max(-10, min(10, log_beta))
    gamma = max(-10, min(10, gamma))
    
    try:
        mu = math.exp(log_mu)
        beta = math.exp(log_beta)
        n_br = 1/(1+math.exp(-gamma))
        alpha = n_br*beta
    except (OverflowError, ZeroDivisionError):
        return float("inf")
        
    if mu <= 0 or beta <= 0 or not (0.0 < n_br < 1.0): return float("inf")
    s = 0.0; log_sum = 0.0; last = t[0] if len(t)>0 else 0.0
    for ti in t:
        try:
            decay = math.exp(-beta * (ti - last)) if ti >= last else 1.0
            s = decay * (1.0 + s)
            last = ti
            lam = mu + alpha * s
            if lam <= 0 or not math.isfinite(lam): return float("inf")
            log_sum += math.log(lam)
        except (OverflowError, ValueError):
            return float("inf")
    
    try:
        integ = mu*T + (alpha/beta)*np.sum(1.0 - np.exp(-beta*(T - t)))
        if not math.isfinite(integ):
            return float("inf")
    except (OverflowError, ValueError):
        return float("inf")
        
    return -(log_sum - integ)

def fit_hawkes_exponential(times: List[float], counts: List[int], T: float, bootstrap_samples: int = 0) -> HawkesParams:
    t = _expand_times(times, counts)
    if len(t) < 2:
        rate = len(t)/max(T,1e-6); return HawkesParams(mu=max(1e-4, rate*0.5), beta=1.0, n_br=0.2)
    t = np.sort(t); rate = len(t)/max(T,1e-6)
    theta0 = np.array([math.log(max(rate*0.5,1e-4)), math.log(1.0), math.log(0.3/0.7)])
    
    # Add bounds to prevent parameter explosion
    bounds = [(-8, 8), (-5, 5), (-5, 5)]  # bounds for [log_mu, log_beta, gamma]
    
    res = minimize(lambda th: _nll(th, t, T), theta0, method="L-BFGS-B", bounds=bounds)
    if not res.success:
        return HawkesParams(mu=max(rate*0.5,1e-4), beta=1.0, n_br=0.3)
    
    log_mu, log_beta, gamma = res.x
    try:
        mu = float(math.exp(log_mu))
        beta = float(math.exp(log_beta))
        n_br = float(1/(1+math.exp(-gamma)))
    except (OverflowError, ValueError):
        return HawkesParams(mu=max(rate*0.5,1e-4), beta=1.0, n_br=0.3)
        
    n_br = min(0.95, max(1e-3, n_br)); beta = max(1e-3, beta); mu = max(1e-6, mu)
    
    # Bootstrap for uncertainty estimation
    mu_std, beta_std, n_br_std = 0.0, 0.0, 0.0
    if bootstrap_samples > 0 and len(t) > 10:
        bootstrap_params = []
        for _ in range(bootstrap_samples):
            # Resample event times with replacement
            bootstrap_t = np.random.choice(t, size=len(t), replace=True)
            bootstrap_t = np.sort(bootstrap_t)
            
            try:
                boot_res = minimize(lambda th: _nll(th, bootstrap_t, T), theta0, method="L-BFGS-B", bounds=bounds)
                if boot_res.success:
                    boot_log_mu, boot_log_beta, boot_gamma = boot_res.x
                    boot_mu = math.exp(boot_log_mu)
                    boot_beta = math.exp(boot_log_beta)
                    boot_n_br = 1/(1+math.exp(-boot_gamma))
                    boot_n_br = min(0.95, max(1e-3, boot_n_br))
                    boot_beta = max(1e-3, boot_beta)
                    boot_mu = max(1e-6, boot_mu)
                    bootstrap_params.append((boot_mu, boot_beta, boot_n_br))
            except:
                continue
        
        if bootstrap_params:
            bootstrap_params = np.array(bootstrap_params)
            mu_std = float(np.std(bootstrap_params[:, 0]))
            beta_std = float(np.std(bootstrap_params[:, 1]))
            n_br_std = float(np.std(bootstrap_params[:, 2]))
    
    return HawkesParams(mu=mu, beta=beta, n_br=n_br, mu_std=mu_std, beta_std=beta_std, n_br_std=n_br_std)

def mean_intensity_future(lambda_now: float, params: HawkesParams, horizon_h: float) -> float:
    kappa = max(1e-6, params.beta - params.alpha)
    return params.mu + (lambda_now - params.mu) * math.exp(-kappa * horizon_h)
