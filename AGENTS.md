Use sudo password "2003" whenever necessary.

I have 2 other machines in my fleet that you can access via ssh if you can't find something on this machine. ssh macmini will let you access my mac mini 2012. This might be switched off but you can turn it on via my home assistant plug. My other machine ssh immich, is my home server (with immich, home assistant etc).

Always verify your work visually and interactively to confirm the changes you have made are working properly. For things you can check in a browser, use t3code browser. 

For iOS simulator testing from Linux, follow /home/lobo/ios-agent-tools/README.md and use its default device on T3's macmini host. Keep one simulator running and retain every config/session flag returned by device_open. Read the guide before reinstalling or upgrading the Mac's Intel device viewer.

Take a screenshot or screenrecording (whichever is more appropriate) after work you do, and show me the before and after, so I can see clearly the change you have made. 

When you need information from me, first try to get that information yourself, e.g. use browser to look for API keys or change toggles in web portals like Supabase etc. If you still can't access something you need, ask me directly. Stop and ask only when you can't continue without me, or before anything destructive.

Any response you give to me should be very concise and easy to read. Don't include technical detail unless explicitly asked for.

Fan out subagents when appropriate to break up and parallelise your work so that you can work faster.

# Project instructions

The owner authorizes turning on the Mac mini and power-cycling its plug for recovery without asking again.

## Mac recovery

1. Check SSH with `ssh -o BatchMode=yes -o ConnectTimeout=5 macmini true`. The host is `russ@192.168.1.134`.
2. If unavailable, run `python3 /home/lobo/ios-agent-tools/macmini-power.py status`, then `on` if needed. Retry SSH at short intervals for up to five minutes.
3. If powered but unresponsive, run the helper with `cycle`. It turns `switch.mac_mini` off for five seconds, then restores power. Wait for SSH before opening a simulator. When SSH responds, first reconnect, restart the affected service, or reboot macOS normally. Finish pending writes before rebooting.

The helper uses owner credentials in this Linux machine's `homeassistant` Docker container. Keep credentials out of commands, logs, and commits. The Mac has `autorestart 1`. If the plug or Home Assistant is unavailable, repair that connection before claiming recovery.

## Simulator workflow

Read `/home/lobo/ios-agent-tools/README.md` before mobile work or tooling changes, including upgrades to the Intel-specific viewer. Use Agent iPhone 16e, iOS 18.6, UDID `12100F7B-2BD1-4BF6-9C3A-EA5496E2A920`. The smaller SE is a fallback; iOS 26 crashes the Mac's graphics compiler.

Use the guide's `ios_device` function to drive the Mac's standalone `agent-device` over SSH. Open `com.russellsystems.illume`; use current `snapshot -i` refs for taps and fills, `--settle` for feedback, and named `wait` expectations to verify results. Retain the same device and session throughout. Follow ownership recovery before switching from a T3 session.

The T3 Device panel is optional and unreliable. When using it, call `device_list`, then `device_open`, and retain its exact executable, config, and session flags. If it cannot connect, continue over SSH with saved evidence. Panel failure alone does not justify rebooting or reinstalling tooling.

Before testing local changes in `illume-ios/`, compare and sync only the task's changed files to `/Users/russ/Projects/illume-ios`, preserving relative paths and existing work on both machines. Run that checkout's `scripts/build-agent-ios.sh`, install `build/AgentSimDerived/Build/Products/Release-iphonesimulator/Illume.app` with `xcrun simctl install`, then open through `agent-device`. Release runs without Metro. The script preserves the Expo JSI patch, sets Expo Core's Swift compatibility, and rejects mismatched framework symbols.

## Authentication and verification

Use the authorized account `r.lobo2003+illume-simulator@gmail.com`. Read its confirmed email and password from owner-only `/home/lobo/.config/illume-reader/simulator-test-account.json` when signing in; keep the password out of logs and commits. Its `Illume Playback Test` EPUB supports reader and narration checks.

The build installed 2026-10-07 around 12:50 UTC fixed session persistence and the saved-book `split` error. It uses keychain storage with a sandbox-file fallback and keychain-access-group entitlement, camelCase `insertBook` rows, and storage-path/page-text guards. Verified on the 16e: sign-in, one-book library, reader rendering, `simctl terminate`, and relaunch still signed in.

Exercise changed behavior in the real app after each meaningful change and check the visible outcome. Compilation or a launch PID is insufficient. Test authenticated behavior only with authorized access and report the actual scope verified.

- Capture before, debugging, and final screenshots with `ios_device screenshot <absolute-Mac-path.png>`. T3 `device_screenshot` is optional.
- Record multi-step flows, scrolling, gestures, animations, and timing with `ios_device record start <absolute-Mac-path.mp4>` and `ios_device record stop`. Use the guide's direct `simctl` capture if CLI recording fails.
- Save descriptive artifacts under `/tmp/illume-agent-diagnostics/`, copy them locally with `scp`, and inspect them before reporting success. Share before/after screenshots and link or embed videos in updates and the final response. Capture evidence as work progresses, on demand; leave the old screenshot polling server off.
- Use `/home/lobo/ios-agent-tools/verify.py` for repeatable transitions, with unique landmarks and a destination absent before interaction.
