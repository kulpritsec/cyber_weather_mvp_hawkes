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
    @property
    def alpha(self): return self.n_br * self.beta

def _expand_times(times: List[float], counts: List[int]) -> np.ndarray:
    expanded = []
    for t, c in zip(times, counts):
        expanded.extend([t] * int(max(1, c)))
    return np.array(expanded, dtype=float)

def _nll(theta: np.ndarray, t: np.ndarray, T: float) -> float:
    log_mu, log_beta, gamma = theta
    mu = math.exp(log_mu); beta = math.exp(log_beta); n_br = 1/(1+math.exp(-gamma)); alpha = n_br*beta
    if mu <= 0 or beta <= 0 or not (0.0 < n_br < 1.0): return float("inf")
    s = 0.0; log_sum = 0.0; last = t[0] if len(t)>0 else 0.0
    for ti in t:
        decay = math.exp(-beta * (ti - last)) if ti >= last else 1.0
        s = decay * (1.0 + s)
        last = ti
        lam = mu + alpha * s
        if lam <= 0 or not math.isfinite(lam): return float("inf")
        log_sum += math.log(lam)
    integ = mu*T + (alpha/beta)*np.sum(1.0 - np.exp(-beta*(T - t)))
    return -(log_sum - integ)

def fit_hawkes_exponential(times: List[float], counts: List[int], T: float) -> HawkesParams:
    t = _expand_times(times, counts)
    if len(t) < 2:
        rate = len(t)/max(T,1e-6); return HawkesParams(mu=max(1e-4, rate*0.5), beta=1.0, n_br=0.2)
    t = np.sort(t); rate = len(t)/max(T,1e-6)
    theta0 = np.array([math.log(max(rate*0.5,1e-4)), math.log(1.0), math.log(0.3/0.7)])
    res = minimize(lambda th: _nll(th, t, T), theta0, method="L-BFGS-B")
    if not res.success:
        return HawkesParams(mu=max(rate*0.5,1e-4), beta=1.0, n_br=0.3)
    log_mu, log_beta, gamma = res.x
    mu = float(math.exp(log_mu)); beta = float(math.exp(log_beta)); n_br = float(1/(1+math.exp(-gamma)))
    n_br = min(0.95, max(1e-3, n_br)); beta = max(1e-3, beta); mu = max(1e-6, mu)
    return HawkesParams(mu=mu, beta=beta, n_br=n_br)

def mean_intensity_future(lambda_now: float, params: HawkesParams, horizon_h: float) -> float:
    kappa = max(1e-6, params.beta - params.alpha)
    return params.mu + (lambda_now - params.mu) * math.exp(-kappa * horizon_h)
