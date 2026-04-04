import yt_dlp
import sys
import os

def download_soundcloud(url, output_filename):
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': f'{output_filename}.%(ext)s',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        # Thêm mắm muối ở đây để lách
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'referer': 'https://soundcloud.com/',
        'ffmpeg_location': 'ffmpeg.exe',
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        print("SUCCESS")
    except Exception as e:
        # In lỗi chi tiết để dễ debug
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        download_soundcloud(sys.argv[1], sys.argv[2])
