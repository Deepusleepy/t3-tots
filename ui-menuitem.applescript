-- T3 Code app: $T3_APP if set, else the running "T3 Code ..." app (stable "T3 Code (Alpha)" or "T3 Code (Nightly)")
on t3App()
  set appName to system attribute "T3_APP"
  if appName is not "" then return appName
  tell application "System Events" to set ps to name of every process whose name starts with "T3 Code"
  if ps is {} then error "T3 Code is not running"
  return item 1 of ps
end t3App
-- usage: osascript ui-menuitem.applescript <title> ; presses the open menu item whose title starts with <title>; "list" prints titles
on run argv
set appName to t3App()
set want to item 1 of argv
tell application "System Events" to tell process appName
  set els to entire contents of window 1
  set out to ""
  repeat with i from 1 to count of els
    set e to item i of els
    try
      if role of e is "AXMenuItem" then
        set t to title of e
        set out to out & t & linefeed
        if want is not "list" and t starts with want then
          perform action "AXPress" of e
          return "selected: " & t
        end if
      end if
    end try
  end repeat
end tell
if want is "list" then return out
return "NOT FOUND: " & want
end run
