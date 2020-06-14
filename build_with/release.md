[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.5.0-pre1.90

Unofficial test of packaging. (Do not redistribute it, please.)

This release is not for general users. Please try this only if you are willing to help the project by checking and reporting bugs. The next version will be officially released soon, in a week or so, if this test is passed without problems.

* Test of [KataGo 1.4.3](https://github.com/lightvector/KataGo/releases/tag/v1.4.3) (OpenCL) for [lizgoban#53](https://github.com/kaorahi/lizgoban/issues/53) and [katago#238](https://github.com/lightvector/KataGo/issues/238).

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

Note that some external resources are also packaged into *.exe together with LizGoban itself. The license of LizGoban is not applied to them, of course.

* engines and neural networks: [Leela Zero](https://github.com/leela-zero/leela-zero/releases/tag/v0.17), [KataGo](https://github.com/lightvector/KataGo/)
* facial stone images: [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html)

# (Previous versions)

## LizGoban 0.5.0-pre1

Thanks to [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html) by Tororo, a new stone style is available in the all-in-one package `LizGoban-*_win_*.zip` for 64bit Windows. The ownerships of stones are indicated by their facial expressions in this style. To try it...

1. Select View > Stone > Face.
2. Select Preset > KataGo. The first run of KataGo may take a long time (1 hour or more, for example) for its initial tuning.
3. (Enable View > Ownership if you have disabled it.)

See README if you want to use this style without the all-in-one package.

### Major changes

* Add "KataGo for wider search" into Preset menu in the all-in-one package.
* Support ownerships of stones by facial expressions.
* Support `*.gib`, `*.ngf`, `*.ugf`, and `*.ugi` in addition to `*.sgf`. (You may need to do "npm install" again.)
* Omit marks for too minor suggestions on the board.
* Experimentally add "Tool > Experimental > Tsumego frame1&2" for solving life & death problems. (See "Tips" section in "Help" menu.)

## LizGoban 0.4.4

* Fix minor bugs etc.

## LizGoban 0.4.3

* Upgrade the built-in engine of the all-in-one package to [KataGo 1.4.2](https://github.com/lightvector/KataGo/releases/tag/v1.4.2) (OpenCL).
* Fix minor bugs etc.

## LizGoban 0.4.2

Fix another bug on match vs. weakened AI.

## LizGoban 0.4.1

Fix and improve match vs. weakened AI.

## LizGoban 0.4.0

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), extract it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engines:

* [Leela Zero 0.17](https://github.com/leela-zero/leela-zero/releases/tag/v0.17) (CPU-only) + [15 blocks network](https://github.com/leela-zero/leela-zero/issues/2192) (0c4ade79) on 2020-04-10
* [KataGo 1.3.5](https://github.com/lightvector/KataGo/releases/tag/v1.3.5) (OpenCL) + 15 blocks network (g170e-b15c192-s1672)

You can switch them by [Preset] menu in LizGoban. The first run of KataGo may take a long time (1 hour or more, for example) for its initial tuning.

### To customize it on 64bit Windows (Leela Zero with GPU, etc.)

1. Prepare engines (Leela Zero and/or KataGo) by yourself, if necessary.
2. Download and extract the same all-in-one package as above.
3. Copy sample/config.json to the same folder as `LizGoban *.exe` and edit it. See README.html for its format.

### To use it on other platforms (Mac, Linux, ...) or Windows with more flexible configuration

Download the source code and see `README.md`.

### Major changes from 0.3.*

* Support better stone images. ("Stone" in "View" menu & experimental stone/board images in the above section)
* Support 9x9 and 13x13 in "File" menu. (See the above KataGo section to shorten their initialization.)
* Add "Rule" into "Edit" menu for KataGo v1.3.
* Add "Match vs. AI" into "File" menu.
* Add "Quick overview" into "Tool" menu.
* Enable "Undelete board" in Edit menu across sessions.
* Plot cumulative score loss.
* [Show mistakes over stones.](https://github.com/featurecat/lizzie/issues/671#issuecomment-586090067)
* Add buttons "?<" and ">?" for previous and next something. (comment, tag, mistake, ko resolution, illegal move)
* Add indicators that suggest highlight scenes of the game (ko fights, etc.).
* Separate estimations by different engines in winrate graph.
* Show coordinates by "c" key.
* Wrap long press of left/right arrow at the beginning/end of games for convenience.
* Recognize handicap stones.
* Read variations in SGF.
* Show start-up log when engine is down.
* Improve thumbnails (delay, color, etc.).
* Add Japanese help.
* Fix blur in HiDPI display.
* Experimentally support saving/loading analyses in SGF. (See the above section.)

Incompatibilities:

* Upgrade libraries (Electron 8, etc.). So you may need to do "npm install" again.
* Recommended config.json is modified for KataGo 1.3.4. (See above.)
* "weight_dir" in config.json is obsolete now. (See above.)
* "label_for_white" is added to "preset" in config.json.
* "Komi" and "Info" are moved from [Tool] to [Edit] menu.
* The shortcut key `CmdOrCtrl+?` is changed from open_exercise_dir to load_recent_exercise.

### Experimental features (not tested well)

You can put your favorite images of board and stones as `board.png`, `black.png`, and `white.png` into the same folder as `LizGoban *.exe` in the all-in-one package (before starting LizGoban). See also "To save/load analyses in SGF" in README.
