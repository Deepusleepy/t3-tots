-- T3 Code app: $T3_APP if set, else the running "T3 Code ..." app (stable "T3 Code (Alpha)" or "T3 Code (Nightly)")
on t3App()
  set appName to system attribute "T3_APP"
  if appName is not "" then return appName
  tell application "System Events" to set ps to name of every process whose name starts with "T3 Code"
  if ps is {} then error "T3 Code is not running"
  return item 1 of ps
end t3App
on run argv
set appName to t3App()
tell application "System Events" to tell process appName
  set els to entire contents of window 1
  set out to ""
  repeat with i from 1 to count of els
    set e to item i of els
    try
      set r to role of e
      if r is in {"AXButton", "AXTextArea", "AXTextField", "AXPopUpButton", "AXMenuButton", "AXComboBox", "AXMenuItem", "AXRadioButton", "AXCheckBox", "AXStaticText"} then
        set p to position of e
        if (item 1 of p) > 300 or r is "AXMenuItem" then
          set d to ""
          try
            set d to description of e
          end try
          if d is "" then
            try
              set d to value of e as text
            end try
          end if
          set out to out & r & " | " & d & " | " & (item 1 of p) & "," & (item 2 of p) & linefeed
        end if
      end if
    end try
  end repeat
  return out
end tell
end run
