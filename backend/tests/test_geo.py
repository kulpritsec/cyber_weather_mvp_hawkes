"""
Unit tests for geospatial utilities.
"""
import pytest
from app.utils.geo import (
    clamp_lat, wrap_lon,
    latlon_to_cell_indices, cell_bounds, cell_polygon,
)


class TestClampLat:
    def test_normal(self):
        assert clamp_lat(45.0) == 45.0

    def test_north_pole(self):
        assert clamp_lat(90.0) == 85.0

    def test_south_pole(self):
        assert clamp_lat(-91.0) == -85.0


class TestWrapLon:
    def test_normal(self):
        assert wrap_lon(120.0) == 120.0

    def test_wrap_positive(self):
        assert wrap_lon(270.0) == -90.0

    def test_wrap_negative(self):
        assert wrap_lon(-270.0) == 90.0

    def test_boundary(self):
        assert wrap_lon(180.0) == 180.0


class TestCellIndexRoundTrip:
    """Ensure converting lat/lon → cell index → bounds contains the original point."""

    @pytest.mark.parametrize("lat,lon", [
        (0.0, 0.0),
        (45.0, -73.0),    # NYC area
        (-33.9, 18.4),    # Cape Town
        (35.7, 139.7),    # Tokyo
        (-85.0, -179.9),  # corner case
    ])
    def test_round_trip(self, lat, lon):
        res = 2.5
        lat_idx, lon_idx = latlon_to_cell_indices(lat, lon, res)
        bounds = cell_bounds(lat_idx, lon_idx, res)

        assert bounds["lat_min"] <= lat < bounds["lat_max"] or lat == 85.0
        assert bounds["lon_min"] <= lon < bounds["lon_max"] or lon == 180.0

    def test_resolution_1_degree(self):
        lat_idx, lon_idx = latlon_to_cell_indices(40.7, -74.0, 1.0)
        bounds = cell_bounds(lat_idx, lon_idx, 1.0)
        assert bounds["lat_max"] - bounds["lat_min"] == pytest.approx(1.0)
        assert bounds["lon_max"] - bounds["lon_min"] == pytest.approx(1.0)


class TestCellPolygon:
    def test_is_closed_ring(self):
        poly = cell_polygon(-10.0, -7.5, 20.0, 22.5)
        coords = poly["coordinates"][0]
        assert coords[0] == coords[-1]
        assert len(coords) == 5

    def test_type(self):
        poly = cell_polygon(0, 2.5, 0, 2.5)
        assert poly["type"] == "Polygon"
