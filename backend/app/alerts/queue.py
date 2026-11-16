"""SIMULATED offline delivery queue for warning messages.

No SMS provider is configured and nothing leaves this machine. The queue behaves like a store-and-forward
field gateway: messages wait while the link is down, attempts can fail, failures are retried with backoff
and give up after a fixed number of attempts. Outcomes are deterministic so the demo is repeatable.
"""
from __future__ import annotations

import threading
import time
import zlib

ATTEMPT_S = 2.5
STAGGER_S = 1.2
BACKOFF_S = [6.0, 12.0, 24.0]
MAX_ATTEMPTS = 3
NOTE = "No SMS provider is configured. Delivery is simulated on this machine; no message is actually sent."


class DeliveryQueue:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.messages: dict[str, dict] = {}
        self.link_online = True
        self._last_warnings: list[dict] = []

    # -- building messages -------------------------------------------------
    @staticmethod
    def _recipients(w: dict) -> list[tuple[str, str]]:
        def number(seed: str) -> str:
            return f"+971 5• ••• ••{zlib.crc32(seed.encode()) % 100:02d}"

        if w["type"] == "supply_shortfall":
            zone = w["affected_zones"][0]
            out = [(f"{zone} farm operators (simulated group)", number(zone))]
            if w["level"] == "ACT":
                out.append(("Oasis water manager (simulated)", number("manager")))
            return out
        return [("Field maintenance duty phone (simulated)", number("maintenance"))]

    def sync(self, warnings: list[dict], now: float | None = None) -> None:
        """Queue a message for every PREPARE / ACT warning that has not been queued at that level yet."""
        now = time.time() if now is None else now
        with self._lock:
            self._last_warnings = warnings
            fresh = 0
            for w in warnings:
                if w["level"] not in {"PREPARE", "ACT"}:
                    continue
                sms = w.get("sms")
                body_en = sms["en"] if sms else f"FALAJLINE {w['level']}: {w['title']}. Open the dashboard for the recommended response."
                body_ar = sms["ar"] if sms else None
                for name, number in self._recipients(w):
                    mid = f"{w['id']}:{w['level']}:{name.split(' ')[0]}"
                    if mid in self.messages:
                        continue
                    idx = len(self.messages)
                    plan = "unreachable" if idx % 5 == 2 else "transient" if idx % 5 == 4 else "ok"
                    self.messages[mid] = {
                        "id": mid,
                        "warning_id": w["id"],
                        "level": w["level"],
                        "recipient": name,
                        "number": number,
                        "channel": "SMS (simulated)",
                        "body": body_en,
                        "body_ar": body_ar,
                        "status": "queued",
                        "attempts": 0,
                        "max_attempts": MAX_ATTEMPTS,
                        "created_at": now,
                        "next_at": now + 1.0 + fresh * STAGGER_S,
                        "delivered_at": None,
                        "last_error": None,
                        "waiting_for_link": False,
                        "history": [{"t": now, "event": "Queued"}],
                        "_plan": plan,
                        "_manual": False,
                    }
                    fresh += 1

    # -- state machine -----------------------------------------------------
    def _advance(self, m: dict, now: float) -> None:
        guard = 0
        while m["status"] in {"queued", "retry_wait", "sending"} and m["next_at"] <= now and guard < 20:
            guard += 1
            t = m["next_at"]
            if m["status"] in {"queued", "retry_wait"}:
                if not self.link_online:
                    if not m["waiting_for_link"]:
                        m["history"].append({"t": now, "event": "Gateway link down: holding message"})
                    m["waiting_for_link"] = True
                    m["next_at"] = now + 0.5
                    return
                if m["waiting_for_link"]:
                    m["history"].append({"t": now, "event": "Gateway link restored"})
                    t = now
                m["waiting_for_link"] = False
                m["attempts"] += 1
                m["status"] = "sending"
                m["next_at"] = t + ATTEMPT_S
                m["history"].append({"t": t, "event": f"Attempt {m['attempts']} of {m['max_attempts']}"})
            else:  # sending -> outcome
                if not self.link_online:
                    m["attempts"] -= 1  # the attempt never left the gateway
                    m["status"] = "queued"
                    m["waiting_for_link"] = True
                    m["next_at"] = now + 0.5
                    m["history"].append({"t": now, "event": "Gateway link lost during send: message kept in queue"})
                    return
                ok = m["_manual"] or m["_plan"] == "ok" or (m["_plan"] == "transient" and m["attempts"] >= 2)
                if ok:
                    m["status"], m["delivered_at"], m["last_error"] = "delivered", t, None
                    m["history"].append({"t": t, "event": "Delivered (simulated handset acknowledgement)"})
                else:
                    m["last_error"] = "Handset unreachable" if m["_plan"] == "unreachable" else "Network timeout"
                    if m["attempts"] >= m["max_attempts"]:
                        m["status"] = "failed"
                        m["history"].append({"t": t, "event": f"Failed after {m['attempts']} attempts: {m['last_error']}"})
                    else:
                        wait = BACKOFF_S[min(m["attempts"] - 1, len(BACKOFF_S) - 1)]
                        m["status"] = "retry_wait"
                        m["next_at"] = t + wait
                        m["history"].append({"t": t, "event": f"{m['last_error']}: retry in {wait:.0f} s"})

    def snapshot(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        with self._lock:
            out = []
            for m in self.messages.values():
                self._advance(m, now)
                label = {
                    "queued": "Pending" + (" · waiting for gateway link" if m["waiting_for_link"] else ""),
                    "sending": f"Sending · attempt {m['attempts']} of {m['max_attempts']}",
                    "retry_wait": f"Retrying · attempt {m['attempts'] + 1} of {m['max_attempts']} in {max(0, m['next_at'] - now):.0f} s"
                    + (" · waiting for gateway link" if m["waiting_for_link"] else ""),
                    "delivered": "Delivered",
                    "failed": f"Failed · {m['last_error']}",
                }[m["status"]]
                public = {k: v for k, v in m.items() if not k.startswith("_")}
                public["status_label"] = label
                public["group"] = {"queued": "pending", "sending": "pending", "retry_wait": "retrying"}.get(m["status"], m["status"])
                public["retry_in_s"] = round(max(0.0, m["next_at"] - now), 1) if m["status"] == "retry_wait" else None
                out.append(public)
            counts = {g: sum(1 for x in out if x["group"] == g) for g in ("pending", "retrying", "delivered", "failed")}
            return {"simulated": True, "provider": None, "note": NOTE, "link_online": self.link_online, "counts": counts,
                    "messages": sorted(out, key=lambda x: x["created_at"]), "server_time": now}

    # -- controls ----------------------------------------------------------
    def set_link(self, online: bool) -> None:
        with self._lock:
            self.link_online = online

    def retry(self, message_id: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            m = self.messages.get(message_id)
            if not m or m["status"] != "failed":
                return False
            m.update(status="queued", attempts=0, next_at=now + 0.8, last_error=None, waiting_for_link=False, _manual=True)
            m["history"].append({"t": now, "event": "Manual retry requested"})
            return True

    def redispatch(self, now: float | None = None) -> None:
        with self._lock:
            self.messages.clear()
            warnings = self._last_warnings
        self.sync(warnings, now)


QUEUE = DeliveryQueue()
