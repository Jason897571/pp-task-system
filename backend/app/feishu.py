"""Minimal Feishu (Lark) bitable client used by the all-tasks sync.

Auth flow mirrors the reference syncer: tenant_access_token → resolve the wiki
node to a bitable app_token → field/record CRUD. Only the standard library is
used (no extra deps); the app must be a collaborator on the target wiki doc with
bitable + wiki permissions.
"""
import json
import urllib.error
import urllib.request

FEISHU_BASE = "https://open.feishu.cn/open-apis"

# Field types we use (Feishu bitable field type ids).
FT_TEXT = 1
FT_DATETIME = 5


class FeishuError(RuntimeError):
    pass


class FeishuClient:
    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.token = self._tenant_token()

    # ---- transport -------------------------------------------------------
    def _request(self, method: str, path: str, body=None):
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {self.token}",
        }
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(FEISHU_BASE + path, data=data, headers=headers, method=method)
        try:
            resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise FeishuError(f"飞书接口 HTTP {e.code} {path}: {detail}") from None
        if resp.get("code") != 0:
            raise FeishuError(f"飞书接口失败 {path}: code={resp.get('code')} msg={resp.get('msg')}")
        return resp.get("data", {})

    def _tenant_token(self) -> str:
        req = urllib.request.Request(
            FEISHU_BASE + "/auth/v3/tenant_access_token/internal",
            data=json.dumps({"app_id": self.app_id, "app_secret": self.app_secret}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            full = json.loads(urllib.request.urlopen(req, timeout=30).read())
        except urllib.error.HTTPError as e:
            raise FeishuError(f"获取飞书 token HTTP {e.code}: {e.read().decode('utf-8', 'replace')}") from None
        if full.get("code") != 0:
            raise FeishuError(f"获取飞书 token 失败: {full.get('msg')}")
        return full["tenant_access_token"]

    # ---- bitable ---------------------------------------------------------
    def resolve_wiki_app_token(self, node_token: str) -> str:
        data = self._request("GET", f"/wiki/v2/spaces/get_node?token={node_token}")
        return data["node"]["obj_token"]

    def list_fields(self, app_token: str, table_id: str) -> list[dict]:
        out, page_token = [], None
        while True:
            q = "?page_size=200" + (f"&page_token={page_token}" if page_token else "")
            data = self._request("GET", f"/bitable/v1/apps/{app_token}/tables/{table_id}/fields{q}")
            out.extend(data.get("items", []))
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
        return out

    def rename_field(self, app_token: str, table_id: str, field_id: str, name: str, ftype: int):
        self._request(
            "PUT",
            f"/bitable/v1/apps/{app_token}/tables/{table_id}/fields/{field_id}",
            {"field_name": name, "type": ftype},
        )

    def create_field(self, app_token: str, table_id: str, name: str, ftype: int, prop=None):
        body = {"field_name": name, "type": ftype}
        if prop is not None:
            body["property"] = prop
        self._request("POST", f"/bitable/v1/apps/{app_token}/tables/{table_id}/fields", body)

    def list_records(self, app_token: str, table_id: str, key_field: str) -> dict:
        """Return {key_text: record_id} indexed by the given key field."""
        out, page_token = {}, None
        while True:
            q = "?page_size=500" + (f"&page_token={page_token}" if page_token else "")
            data = self._request("GET", f"/bitable/v1/apps/{app_token}/tables/{table_id}/records{q}")
            for item in data.get("items", []):
                key = _text(item.get("fields", {}).get(key_field))
                if key:
                    out[key] = item["record_id"]
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
        return out

    def batch_create(self, app_token: str, table_id: str, rows: list[dict]):
        for chunk in _chunks(rows, 500):
            self._request(
                "POST",
                f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create",
                {"records": [{"fields": r} for r in chunk]},
            )

    def batch_update(self, app_token: str, table_id: str, rows: list[dict]):
        # each row: {"record_id": ..., "fields": {...}}
        for chunk in _chunks(rows, 500):
            self._request(
                "POST",
                f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_update",
                {"records": chunk},
            )


def _text(val) -> str:
    if val is None:
        return ""
    if isinstance(val, list):
        return "".join(seg.get("text", "") for seg in val if isinstance(seg, dict)).strip()
    return str(val).strip()


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]
