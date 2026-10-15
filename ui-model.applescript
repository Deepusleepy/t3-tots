-- T3 Code app: $T3_APP if set, else the running "T3 Code ..." app (stable "T3 Code (Alpha)" or "T3 Code (Nightly)")
on t3App()
  set appName to system attribute "T3_APP"
  if appName is not "" then return appName
  tell application "System Events" to set ps to name of every process whose name starts with "T3 Code"
  if ps is {} then error "T3 Code is not running"
  return item 1 of ps
end t3App
-- press the composer's model picker (the AXPopUpButton directly left of the effort picker, x 400-440)
set appName to t3App()
tell application appName to activate
tell application "System Events" to tell process appName
  set els to entire contents of window 1
  repeat with i from 1 to count of els
    set e to item i of els
    try
      if role of e is "AXPopUpButton" then
        set p to position of e
        if (item 1 of p) > 400 and (item 1 of p) < 440 and (item 2 of p) > 300 then
          perform action "AXPress" of e
          return "model picker opened at " & (item 2 of p)
        end if
      end if
    end try
  end repeat
end tell
return "NOT FOUND"
