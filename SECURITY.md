# Security

Report security problems through the **Security** tab of this repository. Choose **Report a vulnerability**. Do not open a public issue.

Include what you found, how to reproduce it, and which version (`VERSION`) you used. I will reply as soon as I can.

T3 Tots tools are read-only by default and never read T3's secrets or auth files; the only credential they read is their own `token` file. If you find a case where they read anything else, where an installer could fetch or install something other than the published files, or where `t3ctl skills` writes outside its `--to` folder and its own `out/` folder, that is a security issue.
