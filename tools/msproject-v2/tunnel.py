#!/usr/bin/env python
"""Generic TCP tunnel through SOCKS5 proxy.

Usage: python tunnel.py <target_host> <target_port> [local_port]
Example: python tunnel.py 100.80.101.53 443 8443
"""
import asyncio
import socket
import struct
import sys

SOCKS_HOST = "127.0.0.1"
SOCKS_PORT = 1055
LOCAL_HOST = "127.0.0.1"


async def socks5_connect(host, port):
    reader, writer = await asyncio.open_connection(SOCKS_HOST, SOCKS_PORT)
    writer.write(b"\x05\x01\x00")
    await writer.drain()
    resp = await reader.readexactly(2)
    if resp[1] != 0:
        raise ConnectionError(f"SOCKS5 auth failed: {resp[1]}")
    addr = socket.inet_aton(host)
    req = b"\x05\x01\x00\x01" + addr + struct.pack(">H", port)
    writer.write(req)
    await writer.drain()
    resp = await reader.readexactly(10)
    if resp[1] != 0:
        raise ConnectionError(f"SOCKS5 connect to {host}:{port} failed: code={resp[1]}")
    return reader, writer


async def pipe(r1, w1, r2, w2):
    async def forward(reader, writer):
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except Exception:
            pass
        finally:
            if not writer.is_closing():
                writer.close()
    await asyncio.gather(forward(r1, w2), forward(r2, w1))


async def handle_client(local_reader, local_writer, target_host, target_port):
    try:
        target_reader, target_writer = await socks5_connect(target_host, target_port)
        await pipe(local_reader, local_writer, target_reader, target_writer)
    except Exception as e:
        print(f"  [X] {e}")
    finally:
        if not local_writer.is_closing():
            local_writer.close()


async def main():
    if len(sys.argv) < 3:
        print("Usage: python tunnel.py <target_host> <target_port> [local_port]")
        print("Example: python tunnel.py 100.86.231.55 5433 5434")
        sys.exit(1)

    target_host = sys.argv[1]
    target_port = int(sys.argv[2])
    local_port = int(sys.argv[3]) if len(sys.argv) > 3 else target_port

    addrs = f"{LOCAL_HOST}:{local_port}"
    target = f"{target_host}:{target_port}"
    print(f"Tunnel: {addrs} -> {target} (via SOCKS5 {SOCKS_HOST}:{SOCKS_PORT})")
    print(f"App connect ke: {addrs}")
    print("Ctrl+C to stop.\n")

    async def handler(r, w):
        await handle_client(r, w, target_host, target_port)

    server = await asyncio.start_server(handler, LOCAL_HOST, local_port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
