#!/usr/bin/env python
"""Forward a local TCP port to PostgreSQL through a SOCKS5 proxy.

Example:
    python scripts/pg_socks_tunnel.py --target-host 100.86.231.55 --target-port 5433 --local-port 15433
"""

from __future__ import annotations

import argparse
import asyncio
import socket
import struct


async def socks5_connect(
    socks_host: str,
    socks_port: int,
    target_host: str,
    target_port: int,
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    reader, writer = await asyncio.open_connection(socks_host, socks_port)

    writer.write(b"\x05\x01\x00")
    await writer.drain()
    response = await reader.readexactly(2)
    if response[1] != 0:
        raise ConnectionError(f"SOCKS5 auth failed: code={response[1]}")

    try:
        addr = socket.inet_aton(target_host)
        request = b"\x05\x01\x00\x01" + addr + struct.pack(">H", target_port)
    except OSError:
        encoded_host = target_host.encode("idna")
        request = (
            b"\x05\x01\x00\x03"
            + bytes([len(encoded_host)])
            + encoded_host
            + struct.pack(">H", target_port)
        )

    writer.write(request)
    await writer.drain()

    header = await reader.readexactly(4)
    if header[1] != 0:
        raise ConnectionError(f"SOCKS5 connect failed: code={header[1]}")

    address_type = header[3]
    if address_type == 1:
        await reader.readexactly(4)
    elif address_type == 3:
        length = await reader.readexactly(1)
        await reader.readexactly(length[0])
    elif address_type == 4:
        await reader.readexactly(16)
    else:
        raise ConnectionError(f"Unexpected SOCKS5 address type: {address_type}")
    await reader.readexactly(2)

    return reader, writer


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    finally:
        if not writer.is_closing():
            writer.close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Local TCP tunnel through SOCKS5")
    parser.add_argument("--socks-host", default="127.0.0.1")
    parser.add_argument("--socks-port", type=int, default=1055)
    parser.add_argument("--local-host", default="127.0.0.1")
    parser.add_argument("--local-port", type=int, default=15433)
    parser.add_argument("--target-host", required=True)
    parser.add_argument("--target-port", type=int, required=True)
    args = parser.parse_args()

    async def handle_client(
        local_reader: asyncio.StreamReader,
        local_writer: asyncio.StreamWriter,
    ) -> None:
        try:
            target_reader, target_writer = await socks5_connect(
                args.socks_host,
                args.socks_port,
                args.target_host,
                args.target_port,
            )
            await asyncio.gather(
                pipe(local_reader, target_writer),
                pipe(target_reader, local_writer),
            )
        except Exception as exc:
            print(f"[tunnel] {exc}", flush=True)
            if not local_writer.is_closing():
                local_writer.close()

    server = await asyncio.start_server(handle_client, args.local_host, args.local_port)
    print(
        f"Tunnel: {args.local_host}:{args.local_port} -> "
        f"{args.target_host}:{args.target_port} via {args.socks_host}:{args.socks_port}",
        flush=True,
    )

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped.")
