@echo off
chcp 65001 >nul
title LMF 인증심사 점검표 준비 - 로컬 서버
cd /d "%~dp0"
echo.
echo  ====================================================
echo   LMF 인증심사 점검표 준비 앱
echo  ====================================================
echo.
echo   브라우저에서 아래 주소로 접속하세요:
echo.
echo     이 PC:      http://127.0.0.1:8765
echo.
echo   휴대폰에서 접속하려면 (같은 Wi-Fi):
echo     1) 이 PC의 IP 확인:  아래 목록 참고
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo        http://%%a:8765
echo     2) 휴대폰 브라우저에 위 주소 입력
echo     3) 메뉴 - 홈 화면에 추가  (앱처럼 설치)
echo.
echo   종료하려면 이 창을 닫으세요.
echo  ====================================================
echo.
python -m http.server 8765
pause
