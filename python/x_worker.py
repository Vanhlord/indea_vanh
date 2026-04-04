#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT_DIR = Path(__file__).resolve().parents[1]
INFO_CACHE_TTL_SECONDS = 60
INFO_CACHE: dict[str, dict[str, object]] = {}
INFO_CACHE_LOCK = threading.Lock()
JOB_QUEUE: queue.Queue[dict[str, object] | None] = queue.Queue()
STDOUT_LOCK = threading.Lock()


def log(message: str) -> None:
    print(f"[x-worker] {message}", file=sys.stderr, flush=True)


def respond(payload: dict[str, object]) -> None:
    with STDOUT_LOCK:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
        sys.stdout.flush()


def resolve_yt_dlp() -> str | None:
    explicit = os.environ.get('YT_DLP_PATH', '').strip()
    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    candidates.extend([
        str(ROOT_DIR / 'yt-dlp.exe'),
        str(Path.cwd() / 'yt-dlp.exe'),
        'yt-dlp.exe',
        'yt-dlp'
    ])

    for candidate in candidates:
        if candidate in ('yt-dlp.exe', 'yt-dlp'):
            return candidate
        if Path(candidate).exists():
            return candidate

    return None


def base_args() -> list[str]:
    return [
        '--no-check-certificate',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        '--extractor-args', 'twitter:api=syndication'
    ]


def run_command(args: list[str], timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False
    )


def normalize_x_url(raw_url: object) -> str | None:
    try:
        parsed = urlsplit(str(raw_url or '').strip())
    except ValueError:
        return None

    if parsed.scheme not in ('http', 'https'):
        return None

    host = (parsed.hostname or '').lower()
    is_x_host = (
        host == 'x.com'
        or host.endswith('.x.com')
        or host == 'twitter.com'
        or host.endswith('.twitter.com')
        or host == 't.co'
        or host.endswith('.t.co')
    )

    if not is_x_host:
        return None

    if host == 'x.com' or host.endswith('.x.com'):
        parsed = parsed._replace(netloc='twitter.com')

    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment))


def pick_thumbnail(info: dict[str, object]) -> str:
    thumbnail = info.get('thumbnail')
    if isinstance(thumbnail, str) and thumbnail:
        return thumbnail

    thumbnails = info.get('thumbnails')
    if isinstance(thumbnails, list):
        for item in thumbnails:
            if isinstance(item, dict):
                url = item.get('url')
                if isinstance(url, str) and url:
                    return url

    return ''


def pick_preview_url(info: dict[str, object]) -> str:
    formats = info.get('formats')
    ranked: list[dict[str, object]] = []

    if isinstance(formats, list):
        for item in formats:
            if isinstance(item, dict) and isinstance(item.get('url'), str):
                ranked.append(item)

    def sort_key(item: dict[str, object]) -> tuple[int, int, int]:
        height = int(item.get('height') or 0)
        bitrate = int(item.get('tbr') or 0)
        ext = str(item.get('ext') or '')
        ext_score = 1 if ext == 'mp4' else 0
        return (-height, -bitrate, -ext_score)

    ranked.sort(key=sort_key)
    preferred = None
    for item in ranked:
        vcodec = str(item.get('vcodec') or '')
        if vcodec and vcodec != 'none':
            preferred = item
            break

    if preferred is None and ranked:
        preferred = ranked[0]

    if preferred and isinstance(preferred.get('url'), str):
        return str(preferred['url'])

    for fallback_key in ('url', 'webpage_url'):
        value = info.get(fallback_key)
        if isinstance(value, str) and value:
            return value

    return ''


def cache_get(url: str) -> dict[str, object] | None:
    now = time.time()
    with INFO_CACHE_LOCK:
        cached = INFO_CACHE.get(url)
        if not cached:
            return None

        if now - float(cached.get('cachedAt', 0)) > INFO_CACHE_TTL_SECONDS:
            INFO_CACHE.pop(url, None)
            return None

        data = cached.get('data')
        return data if isinstance(data, dict) else None


def cache_set(url: str, data: dict[str, object]) -> None:
    with INFO_CACHE_LOCK:
        INFO_CACHE[url] = {
            'cachedAt': time.time(),
            'data': data
        }


def get_info(url: object) -> dict[str, object]:
    target_url = normalize_x_url(url)
    if not target_url:
        raise ValueError('Link X/Twitter không hợp lệ!')

    cached = cache_get(target_url)
    if cached:
        return {**cached, 'cached': True}

    yt_dlp_path = resolve_yt_dlp()
    if not yt_dlp_path:
        raise RuntimeError('Lỗi server: Không tìm thấy yt-dlp.exe!')

    args = [yt_dlp_path, *base_args(), '--dump-json', target_url]
    log(f'Info command: {yt_dlp_path} {" ".join(args[1:])}')

    result = run_command(args, 30)
    if result.returncode != 0:
        stderr = (result.stderr or '').strip()
        stdout = (result.stdout or '').strip()
        raise RuntimeError(stderr or stdout or f'yt-dlp exited with code {result.returncode}')

    info = json.loads(result.stdout)
    if not isinstance(info, dict):
        raise RuntimeError('yt-dlp trả về dữ liệu không hợp lệ.')

    data = {
        'title': info.get('title') or info.get('fulltitle') or 'X video',
        'author': info.get('uploader') or info.get('channel') or info.get('creator') or info.get('uploader_id') or '',
        'thumbnail': pick_thumbnail(info),
        'duration': int(info.get('duration') or 0),
        'previewUrl': pick_preview_url(info),
        'raw': info
    }
    cache_set(target_url, data)
    return data


def download_video(url: object, output_path: object, file_name: object) -> dict[str, object]:
    target_url = normalize_x_url(url)
    if not target_url:
        raise ValueError('Link X/Twitter không hợp lệ!')

    yt_dlp_path = resolve_yt_dlp()
    if not yt_dlp_path:
        raise RuntimeError('Lỗi server: Không tìm thấy yt-dlp.exe!')

    output_path_text = str(output_path or '').strip()
    if not output_path_text:
        raise ValueError('Thiếu outputPath.')

    output_dir = Path(output_path_text).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    args = [
        yt_dlp_path,
        *base_args(),
        '--no-playlist',
        '--concurrent-fragments', '4',
        '--buffer-size', '16M',
        '--http-chunk-size', '10M',
        '--retries', '3',
        '--fragment-retries', '3',
        '--no-part',
        '--merge-output-format', 'mp4',
        '-f', 'bestvideo*+bestaudio/best',
        '-o', output_path_text,
        target_url
    ]

    log(f'Download command: {yt_dlp_path} {" ".join(args[1:])}')

    result = run_command(args, 120)
    if result.returncode != 0:
        stderr = (result.stderr or '').strip()
        stdout = (result.stdout or '').strip()
        raise RuntimeError(stderr or stdout or f'yt-dlp exited with code {result.returncode}')

    output_file = Path(output_path_text)
    if not output_file.exists():
        raise RuntimeError('Không tìm thấy file sau khi xử lý.')

    return {
        'outputPath': str(output_file),
        'fileName': str(file_name or output_file.name),
        'size': output_file.stat().st_size
    }


def worker_loop() -> None:
    while True:
        job = JOB_QUEUE.get()
        if job is None:
            return

        job_id = str(job.get('id') or '').strip()
        job_type = str(job.get('type') or '').strip().lower()

        try:
            if job_type == 'info':
                data = get_info(job.get('url'))
            elif job_type == 'download':
                data = download_video(job.get('url'), job.get('outputPath'), job.get('fileName'))
            else:
                raise ValueError(f'Unsupported job type: {job_type}')

            respond({'id': job_id, 'ok': True, 'data': data})
        except Exception as error:
            respond({'id': job_id, 'ok': False, 'error': str(error)})


def input_loop() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            respond({'id': None, 'ok': False, 'error': 'Invalid JSON payload'})
            continue

        if not isinstance(payload, dict):
            respond({'id': None, 'ok': False, 'error': 'Payload must be an object'})
            continue

        if str(payload.get('type') or '').strip().lower() == 'shutdown':
            break

        JOB_QUEUE.put(payload)

    JOB_QUEUE.put(None)


def main() -> int:
    log('ready')

    worker_thread = threading.Thread(target=worker_loop, daemon=True)
    worker_thread.start()

    try:
        input_loop()
    except KeyboardInterrupt:
        pass

    worker_thread.join(timeout=5)
    log('stopped')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
