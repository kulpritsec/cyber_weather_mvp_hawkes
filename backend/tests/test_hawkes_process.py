"""
Unit tests for the Hawkes process fitting engine.
"""
import math
import numpy as np
import pytest
from app.forecast.hawkes_process import (
    fit_hawkes_exponential,
    mean_intensity_future,
    HawkesParams,
    _expand_times,
    _nll,
)


class TestExpandTimes:
    def test_basic(self):
        result = _expand_times([1.0, 2.0], [2, 3])
        assert len(result) == 5
        assert list(result) == [1.0, 1.0, 2.0, 2.0, 2.0]

    def test_single_count(self):
        result = _expand_times([5.0], [1])
        assert len(result) == 1

    def test_empty(self):
        result = _expand_times([], [])
        assert len(result) == 0


class TestNLL:
    def test_degenerate_params_return_large_or_inf(self):
        t = np.array([0.1, 0.5, 1.0])
        # Extreme parameters should return a large penalty or inf, not crash
        result = _nll(np.array([100, 100, 100]), t, 2.0)
        assert result > 1000 or result == float("inf")

    def test_reasonable_params_finite(self):
        t = np.array([0.1, 0.5, 1.0, 1.5, 2.0])
        # log(mu)=0 → mu=1, log(beta)=0 → beta=1, gamma=0 → n_br=0.5
        result = _nll(np.array([0.0, 0.0, 0.0]), t, 3.0)
        assert math.isfinite(result)


class TestFitHawkesExponential:
    def test_minimum_events_fallback(self):
        """With < 2 events, should return sensible defaults."""
        params = fit_hawkes_exponential([1.0], [1], 10.0)
        assert params.mu > 0
        assert params.beta > 0
        assert 0 < params.n_br < 1

    def test_basic_fit(self):
        """With synthetic Poisson-like data, mu should be near the empirical rate."""
        np.random.seed(42)
        T = 100.0
        n_events = 500
        times = sorted(np.random.uniform(0, T, n_events).tolist())
        counts = [1] * n_events
        params = fit_hawkes_exponential(times, counts, T)

        # mu should be in the ballpark of the empirical rate
        empirical_rate = n_events / T
        assert params.mu > 0
        assert params.mu < empirical_rate * 3  # not wildly off
        assert 0 < params.n_br < 1
        assert params.beta > 0

    def test_bootstrap_produces_uncertainty(self):
        """Bootstrap should produce non-zero std estimates."""
        np.random.seed(123)
        T = 50.0
        times = sorted(np.random.uniform(0, T, 200).tolist())
        counts = [1] * 200
        params = fit_hawkes_exponential(times, counts, T, bootstrap_samples=10)

        # At least one std should be non-zero
        assert params.mu_std > 0 or params.beta_std > 0 or params.n_br_std > 0

    def test_branching_ratio_bounded(self):
        """n_br should always be in (0, 1)."""
        np.random.seed(7)
        times = sorted(np.random.uniform(0, 10, 50).tolist())
        counts = [1] * 50
        params = fit_hawkes_exponential(times, counts, 10.0)
        assert 0 < params.n_br < 1

    def test_alpha_property(self):
        p = HawkesParams(mu=1.0, beta=2.0, n_br=0.5)
        assert p.alpha == pytest.approx(1.0)


class TestMeanIntensityFuture:
    def test_decays_toward_mu(self):
        params = HawkesParams(mu=5.0, beta=2.0, n_br=0.3)
        lambda_now = 20.0
        lam_1h = mean_intensity_future(lambda_now, params, 1.0)
        lam_24h = mean_intensity_future(lambda_now, params, 24.0)
        # Should decay toward mu over time
        assert lam_1h < lambda_now
        assert lam_24h < lam_1h
        assert lam_24h == pytest.approx(params.mu, abs=1.0)

    def test_at_equilibrium(self):
        params = HawkesParams(mu=5.0, beta=2.0, n_br=0.3)
        # If lambda_now == mu, forecast should stay near mu
        lam = mean_intensity_future(params.mu, params, 10.0)
        assert lam == pytest.approx(params.mu, rel=0.01)

    def test_zero_horizon(self):
        params = HawkesParams(mu=5.0, beta=2.0, n_br=0.3)
        lam = mean_intensity_future(20.0, params, 0.0)
        assert lam == pytest.approx(20.0, rel=0.01)
