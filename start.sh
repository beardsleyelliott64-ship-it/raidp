#!/bin/bash
# set LD_LIBRARY_PATH only at runtime so playwright finds apt-installed libstdc++
# without poisoning the nix build environment
export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
exec /opt/venv/bin/python bot.py
