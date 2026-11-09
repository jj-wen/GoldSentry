; 覆盖 electron-builder 默认的 CHECK_APP_RUNNING：默认会弹“程序正在运行”的确认框。
; 这里直接结束 GoldSentry（含 renderer/GPU 子进程），让安装/卸载直接覆盖旧文件。
!macro customCheckAppRunning
  DetailPrint "正在关闭正在运行的 ${PRODUCT_NAME}..."
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" >NUL 2>NUL`
  Sleep 800
!macroend
