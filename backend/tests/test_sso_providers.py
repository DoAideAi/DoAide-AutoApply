"""The SPA renders only the SSO buttons this endpoint names."""
from app.routers import oauth_sso


def test_lists_only_configured_providers(client, monkeypatch):
    monkeypatch.setattr(oauth_sso, "GOOGLE_SSO_CLIENT_ID", "cid")
    monkeypatch.setattr(oauth_sso.settings, "github_client_id", "")
    monkeypatch.setattr(oauth_sso.settings, "microsoft_client_id", "")
    resp = client.get("/api/v1/auth/sso/providers")
    assert resp.status_code == 200
    assert resp.json() == {"providers": ["google"]}


def test_lists_nothing_when_unconfigured(client, monkeypatch):
    monkeypatch.setattr(oauth_sso, "GOOGLE_SSO_CLIENT_ID", "")
    monkeypatch.setattr(oauth_sso.settings, "github_client_id", "")
    monkeypatch.setattr(oauth_sso.settings, "microsoft_client_id", "")
    assert client.get("/api/v1/auth/sso/providers").json() == {"providers": []}
