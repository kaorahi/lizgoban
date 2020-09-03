[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.5.0-pre4

* Modify the built-in engines of the all-in-one package.
  * Upgrade KataGo to [1.6.1](https://github.com/lightvector/KataGo/releases/tag/v1.6.1).
  * Pack three versions of KataGo (CPU, modern CPU, GPU).
  * Drop Leela Zero to reduce the file size.
* Make KataGo aggressive for handicap games automatically in "match vs. AI" or "AI vs. AI". ("!" is appended to the engine names in the title bar.)
* In "AI vs. AI", show the principal variations of both AIs side by side by "1" key (keep holding down) if "Two boards A (main+PV)" is selected from "View" menu.
* Separate estimations for different komi etc. in winrate graph.
* Support HA (handicap) property in SGF.
* Fix minor bugs.

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), extract it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engine:

* [KataGo 1.6.1](https://github.com/lightvector/KataGo/releases/tag/v1.6.1) (eigen, eigen-avx2, opencl) + [15 blocks network](https://d3dndmfyhecmj0.cloudfront.net/g170/neuralnets/index.html) (g170e-b15c192-s1672 from [KataGo 1.4.5](https://github.com/lightvector/KataGo/releases/tag/v1.4.5))

You can switch KataGo versions (CPU, modern CPU, GPU) by [Preset] menu in LizGoban. The first run of the GPU version may take a long time (1 hour on a low-spec machine, for example) for its initial tuning.

### To customize it on 64bit Windows

If you want to use other engines, network files, options, ...

1. Prepare engines (Leela Zero and/or KataGo) and their network files (aka. weights, models) by yourself, if necessary.
2. Download and extract the same all-in-one package as above.
3. Copy sample/config.json to the same folder as `LizGoban *.exe` and edit it. See README for its format.

### To use it on other platforms (Mac, Linux, ...) or Windows with more flexible configuration

Download the source code and see `README.md`.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

Note that some external resources are also packaged into *.exe together with LizGoban itself. The license of LizGoban is not applied to them, of course.

* engines and neural networks: [KataGo](https://github.com/lightvector/KataGo/)
* facial stone images: [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html)

# (Previous versions)

## LizGoban 0.5.0-pre3

* Upgrade the built-in engine of the all-in-one package to [KataGo 1.5.0](https://github.com/lightvector/KataGo/releases/tag/1.5.0) (OpenCL) for better performance in some environments.
* Borrow some ideas from [KaTrain](https://github.com/sanderland/katrain/).
  * Show mistakes and actually punished scores on stones.
  * Click on a stone to temporarily show the past board.
  * Double-click on a stone to jump to the move.
* Improve display by "c" key + mouse hover on existing stones.
* Improve "Tool > Experimental > Tsumego frame" for solving life & death problems. (See "Tips" section in "Help" menu.)
* Officially support reuse of analyses like Lizzie.
* Add "Save/Copy SGF with analysis" into menu. (compatible with Lizzie 0.7.2)
* Automatically start quick overview after reading SGF.
* Stop pondering in match vs. AI if human's move is played in pausing.
* Fix minor bugs etc.

Incompatibilities:

* Upgrade libraries (Electron 9, etc.). So you may need to do "npm install" again.

## LizGoban 0.5.0-pre2

* Fix KataGo's initial tuning in every run of the all-in-one package.
* Upgrade the built-in engine of the all-in-one package to [KataGo 1.4.4](https://github.com/lightvector/KataGo/releases/tag/v1.4.4) (OpenCL) for the above fix.
* Modify "File" menu slightly for convenience.
* Add more configurations (rules, komi, handicap) into `preset` in `config.json`.

## LizGoban 0.5.0-pre1

Thanks to [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html) by Tororo, a new stone style is available in the all-in-one package `LizGoban-*_win_*.zip` for 64bit Windows. The ownerships of stones are indicated by their facial expressions in this style. To try it...

1. Select View > Stone > Face.
2. Select Preset > KataGo. The first run of KataGo may take a long time (1 hour or more, for example) for its initial tuning.
3. (Enable View > Ownership if you have disabled it.)

See README if you want to use this style without the all-in-one package.
