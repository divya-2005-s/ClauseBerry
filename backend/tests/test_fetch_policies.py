import socket

import httpx
import pytest

from pipeline import fetch_policies


def _public_dns(monkeypatch):
    monkeypatch.setattr(
        fetch_policies.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))],
    )


def test_policy_urls_must_use_http_or_https_and_public_hosts(monkeypatch):
    _public_dns(monkeypatch)
    for url in (
        "file:///etc/passwd",
        "http://127.0.0.1/policy",
        "http://169.254.169.254/latest/meta-data",
        "http://user:password@example.com/policy",
    ):
        with pytest.raises(fetch_policies.UnsafeTargetError):
            fetch_policies._validate_public_url(url)


def test_policy_url_rejects_host_resolving_to_private_address(monkeypatch):
    monkeypatch.setattr(
        fetch_policies.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 0))],
    )
    with pytest.raises(fetch_policies.UnsafeTargetError, match="public IP"):
        fetch_policies._validate_public_url("https://policy.example/privacy")


def test_fetch_rejects_redirect_to_private_address(monkeypatch):
    _public_dns(monkeypatch)
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(302, headers={"Location": "https://127.0.0.1/admin"}, request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        code, content, error = fetch_policies.fetch(client, "https://policy.example/privacy")

    assert (code, content) == (None, None)
    assert "public IP" in error
    assert len(requests) == 1


def test_fetch_follows_validated_public_redirects(monkeypatch):
    _public_dns(monkeypatch)
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.host == "policy.example":
            return httpx.Response(302, headers={"Location": "https://cdn.example/privacy"}, request=request)
        return httpx.Response(200, text="policy", request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        code, content, error = fetch_policies.fetch(client, "https://policy.example/privacy")

    assert (code, content, error) == (200, "policy", None)
    assert [request.url.host for request in requests] == ["policy.example", "cdn.example"]


def test_robots_txt_missing_allows_fetch(monkeypatch):
    _public_dns(monkeypatch)
    fetch_policies._robots.clear()

    def respond(request):
        return httpx.Response(404, request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert fetch_policies.robots_allows(client, "https://policy.example/privacy")


def test_robots_txt_disallow_rule_is_honored(monkeypatch):
    _public_dns(monkeypatch)
    fetch_policies._robots.clear()

    def respond(request):
        return httpx.Response(
            200, text="User-agent: *\nDisallow: /private\n", request=request
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert not fetch_policies.robots_allows(client, "https://policy.example/private/policy")


def test_robots_txt_server_error_blocks_fetch(monkeypatch):
    _public_dns(monkeypatch)
    fetch_policies._robots.clear()

    def respond(request):
        return httpx.Response(503, request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(fetch_policies.RobotsUnavailableError):
            fetch_policies.robots_allows(client, "https://policy.example/privacy")


def test_robots_txt_network_error_blocks_fetch(monkeypatch):
    _public_dns(monkeypatch)
    fetch_policies._robots.clear()

    def respond(_request):
        raise httpx.ConnectError("unavailable")

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(fetch_policies.RobotsUnavailableError):
            fetch_policies.robots_allows(client, "https://policy.example/privacy")
