-- T3 Code app: $T3_APP if set, else the running "T3 Code ..." app (stable "T3 Code (Alpha)" or "T3 Code (Nightly)")
on t3App()
  set appName to system attribute "T3_APP"
  if appName is not "" then return appName
  tell application "System Events" to set ps to name of every process whose name starts with "T3 Code"
  if ps is {} then error "T3 Code is not running"
  return item 1 of ps
end t3App
-- usage: osascript ui-press.applescript <role> <description prefix>
on run argv
set appName to t3App()
set wantRole to item 1 of argv
set wantDesc to item 2 of argv
tell application appName to activate
tell application "System Events" to tell process appName
  set els to entire contents of window 1
  repeat with i from 1 to count of els
    set e to item i of els
    try
      if role of e is wantRole then
        set d to description of e
        if d starts with wantDesc then
          perform action "AXPress" of e
          return "pressed: " & d
        end if
      end if
    end try
  end repeat
end tell
return "NOT FOUND: " & wantRole & " " & wantDesc
end run
