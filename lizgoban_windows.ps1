$conf = "config.json"
$command = "npm start"

if (Test-Path $conf) {
    $command = "$command -- -c $conf"
}

Start-Process -NoNewWindow -FilePath "cmd.exe" -ArgumentList "/c $command"
