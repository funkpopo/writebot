@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: WriteBot SSL 证书安装脚本
:: 需要管理员权限运行

:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ============================================
    echo   需要管理员权限来安装证书
    echo   请右键点击此文件，选择"以管理员身份运行"
    echo ============================================
    pause
    exit /b 1
)

:: 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
set "CERT_FILE=%SCRIPT_DIR%..\release\WriteBot\certs\funkpopo-writebot.crt"

:: 如果在 release 目录中运行，使用相对路径
if not exist "%CERT_FILE%" (
    set "CERT_FILE=%SCRIPT_DIR%certs\funkpopo-writebot.crt"
)

:: 检查证书文件是否存在
if not exist "%CERT_FILE%" (
    echo ============================================
    echo   错误：找不到证书文件
    echo   请确保 certs\funkpopo-writebot.crt 文件存在
    echo ============================================
    pause
    exit /b 1
)

echo ============================================
echo   WriteBot SSL 证书安装
echo   证书名称: funkpopo-writebot
echo ============================================
echo.
echo 正在安装证书到受信任的根证书存储...
echo 证书文件: %CERT_FILE%
echo.

:: 安装证书到受信任的根证书存储
certutil -addstore -f "Root" "%CERT_FILE%"

if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   证书安装成功！
    echo   证书名称: funkpopo-writebot
    echo   现在可以正常使用 WriteBot 加载项了
    echo ============================================
) else (
    echo.
    echo ============================================
    echo   证书安装失败
    echo   错误代码: %errorlevel%
    echo ============================================
)

echo.
pause
