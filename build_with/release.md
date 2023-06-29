[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.8.0-pre2

* Upgrade KataGo to [1.13.0](https://github.com/lightvector/KataGo/releases/tag/v1.13.0).
* Provide simpler methods to replace the built-in engine / network. Details are available in the notes below.
* Add leadings chart.
* Delete move numbers from tsumego frame to prevent potential confusion for KataGo.

Incompatibilities:

* Upgrade libraries (Electron 25, etc.). So you may need to do "npm install" again if you use LizGoban from the command line.

## LizGoban 0.8.0-pre1

* Blur ownership display. (Borrow the idea from [katrain#555](https://github.com/sanderland/katrain/issues/555).)
* Replace zone indicator with SOPPO indicator for successive misses of the best move.
* Add ownership distribution chart at the bottom left. (Press "x" key to enlarge it.)
* Add thin red background for "hot" periods in winrate graph.
* Add "ambiguity of areas" (faint gray line) and "settled territories" (faint green/pink dots) to score graph.
* Highlight settled areas by "v" key.
* Make long press of cursor keys smoother.
* Fix minor bugs.

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), unzip it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engine:

* [KataGo 1.13.0](https://github.com/lightvector/KataGo/releases/tag/v1.13.0) (eigen, eigenavx2, opencl) + [15 block network](https://katagotraining.org/networks/) (g170e-b15c192-s1672 from [KataGo 1.4.5](https://github.com/lightvector/KataGo/releases/tag/v1.4.5))

You can switch KataGo versions (CPU, modern CPU, GPU) by [Preset] menu in LizGoban. The first run of the GPU version may take a long time (1 hour on a low-spec machine, for example) for its initial tuning.

### To customize it on 64bit Windows

If you want to replace built-in network (aka. model, weights)...

1. Download and unzip the same all-in-one package as above.
2. Copy `sample/custom_model/config.json` to the same folder as `LizGoban *.exe`.
3. [Download your favorite network](https://katagotraining.org/networks/), rename it to `katanetwork.gz`, and place it in the same folder.

If you want to replace built-in katago...

1. Download and unzip the same all-in-one package as above.
2. Copy `sample/custom_katago/config.json` to the same folder as `LizGoban *.exe`.
3. Place your favorite katago and its network in the same folder. They must be renamed to `katago.exe` and `katanetwork.gz`, respectively.

If you just want to modify the configurations of built-in katago...

1. Download and unzip the same all-in-one package as above.
2. Copy `sample/built_in/config.json` to the same folder as `LizGoban *.exe`.
3. Edit it as you like. See README for its format.

### To use it on other platforms (Mac, Linux, ...) or Windows with more flexible configuration

Download the source code and see `README.md`.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

Note that some external resources are also packaged into *.exe together with LizGoban itself. The license of LizGoban is not applied to them, of course.

* engines and neural networks: [KataGo](https://github.com/lightvector/KataGo/)
* facial stone images: [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html)
