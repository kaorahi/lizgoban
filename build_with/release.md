[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.4.0-pre3

* Upgrade the built-in engine of the all-in-one package to [KataGo 1.3.5](https://github.com/lightvector/KataGo/releases/tag/v1.3.5) (OpenCL) for faster loading.
* Improve stone images. (Please change View > Stone if you have performance problems.)
* Enable "Undelete board" in Edit menu across sessions for recovery from unintentional quit.
* Plot cumulative score loss.
* [Show mistakes over stones.](https://github.com/featurecat/lizzie/issues/671#issuecomment-586090067)
* Add "Match vs. AI" into "File" menu.
* Add buttons "?<" and ">?" for previous and next something. (comment, tag, mistake, ko resolution, illegal move)
* Show coordinates by "c" key.
* Recognize handicap stones.
* Read variations in SGF.
* Improve thumbnails (delay, color, etc.).

See also "LizGoban 0.3.*" below for usage and customization, though some descriptions are obsolete now. (You do not need "another unofficial binary" for Japanese rule any longer.)

### Experimental features (not tested well)

You can put your favorite images of board and stones as `board.png`, `black.png`, and `white.png` into the same folder as `LizGoban *.exe` in the all-in-one package (before starting LizGoban). See also "To save/load analyses in SGF" in README.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

# (Previous versions)

## LizGoban 0.4.0-pre2

* Upgrade the built-in engine of the all-in-one package to [KataGo 1.3.2](https://github.com/lightvector/KataGo/releases/tag/v1.3.2) (OpenCL) + 15 blocks network (g170e-b15c192-s1672).
* Upgrade libraries (Electron 8, etc.).
* Rename "aggressive KataGo" to "KataGo for handicap games" in "Preset" menu.
* Fix small bugs etc.

## LizGoban 0.4.0-pre1

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

## LizGoban 0.3.1

Fix bugs in 0.3.0. (store_as_exercise in Windows, open_url for HTTP, etc.)

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), extract it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engines:

* [Leela Zero 0.17](https://github.com/leela-zero/leela-zero/releases/tag/v0.17) (CPU-only) + [15 blocks network](https://github.com/leela-zero/leela-zero/issues/2192) (a4b58a91) on 2019-11-10
* [KataGo 1.2](https://github.com/lightvector/KataGo/releases/tag/v1.2) (OpenCL) + [10 blocks network](https://github.com/lightvector/KataGo/issues/88) (s4588) on 2019-12-20

You can switch them by [Preset] menu in LizGoban. The first run of KataGo may take a long time (1 hour or more, for example) for its initial tuning.

### To customize it on 64bit Windows (Leela Zero with GPU, KataGo in Japanese rule, ...)

1. Prepare engines (Leela Zero and/or KataGo) by yourself, if necessary.
2. Download and extract the same all-in-one package as above.
3. Copy sample/config.json to the same folder as `LizGoban *.exe` and edit it. See README.html for its format.

Note that the built-in KataGo is the official binary. You may need to get another unofficial binary (from [Lizzie](https://github.com/featurecat/lizzie/releases) etc.) to use Japanese rule.

### To use it on other platforms (Mac, Linux, ...) or Windows with more flexible configuration

Download the source code and see `README.md`.

### Major changes from 0.2.0

* Open URL by drag & drop or clipboard.
* Count stones separately in area counts. (See "KataGo" section in "Help" menu.)
* Flip & rotate the board randomly in exercise.
* Replace KataGo network with a stronger one.
* Fix bugs.
