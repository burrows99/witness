"""A tiny pricing service: the L3 subject under mutation.

Deliberately small and boring. Every mutation below breaks one behaviour that
a plan drives, so "did the gate catch it" is a question about the gate rather
than about the fixture.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

ITEMS = [
    {"sku": "a", "price": 10.0, "qty": 2},
    {"sku": "b", "price": 5.0, "qty": 1},
    {"sku": "c", "price": 2.5, "qty": 4},
]


def cart_total(items):
    total = 0.0
    for item in items:
        total += item["price"] * item["qty"]
    return round(total, 2)


def apply_discount(total, tier):
    if tier >= 2:
        discount = total * 0.10
        return round(total - discount, 2)
    return total


def paginate(items, page, size):
    start = (page - 1) * size
    return items[start:start + size]


def load_config(raw):
    try:
        return json.loads(raw)
    except ValueError:
        return {"mode": "default"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path == "/health":
            return self.send_json(200, {"status": "ok"})
        if url.path == "/cart/total":
            tier = int(query.get("tier", ["0"])[0])
            total = cart_total(ITEMS)
            return self.send_json(200, {"total": apply_discount(total, tier), "subtotal": total})
        if url.path == "/items":
            page = int(query.get("page", ["1"])[0])
            size = int(query.get("size", ["2"])[0])
            return self.send_json(200, {"items": paginate(ITEMS, page, size)})
        if url.path == "/config":
            return self.send_json(200, load_config(query.get("raw", ["{}"])[0]))
        return self.send_json(404, {"error": "not found"})

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
