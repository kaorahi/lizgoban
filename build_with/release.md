LizGoban 0.4.0-pre1

Thanks to KataGo, we have an incredibly strong AI for highly handicapped games now.
To enjoy it on LizGoban, select "aggressive KataGo" from "Preset" menu in the all-in-one package or use KataGo with another gtp.cfg. See gtp_aggressive.cfg in README for the latter case.

### Major changes

* Upgrade the built-in engine of the all-in-one package to [KataGo 1.3.1](https://github.com/lightvector/KataGo/releases/tag/v1.3.1) (OpenCL) + [10 blocks network](https://github.com/lightvector/KataGo/releases/tag/v1.3) (g170e-b10c128-s1141) in v1.3.
* Support 9x9 and 13x13 in "File" menu.
* Add "Rule" into "Edit" menu for KataGo v1.3.
* Add indicators that suggest highlight scenes of the game (big kills, ko fights, etc.).
* Separate estimations by different engines in winrate graph.
* Show start-up log when engine is down.
* Fix blur in HiDPI display.

### Incompatibilities

* Upgrade libraries (Electron 7, etc.). So you may need to do "npm install" again.
* "weight_dir" in config.json is obsolete now. (See README.)
* "Komi" and "Info" are moved from "Tool" to "Edit" menu.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)
