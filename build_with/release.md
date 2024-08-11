[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.8.0-pre6

This is just a temporary release for a debug feature on the asymmetric rank humanSL profile. This feature will be excluded from the next release.

KataGo is upgraded to [1.15.3](https://github.com/lightvector/KataGo/releases/tag/v1.15.3).

### To test the asymmetric rank humanSL profile on Windows

(Sorry for the long steps. This is just a debug feature.)

1. Download the all-in-one package (`LizGoban-*_win_*.zip`), unzip it, and double-click `LizGoban *.exe`.
2. From "Preset" menu, choose "Human-like Analysis".
3. From "Tool" menu, choose "Experimental" > "Enable debug menu".
4. From "Debug" menu, choose "Asymmetric humanSL rank" to toggle it on.
5. From "Edit" menu, choose "Preferences" to open the dialog and adjust the sliders as you like. Toggle "Lizzie style" off if the display is hard to see.

For example, you can set the blue slider to `rank_1d` and the red slider to `rank_5k` to compare the policies between "1d" and "1d against 5k". The former indicates "I'm 1d", while the latter indicates "I'm 1d and I know you're 5k". These policies, p and q, are shown by blue or red squares on the board (size = max(p,q), color = log(p/q)). Blue squares mean p > q, and red squares mean p < q.

## LizGoban 0.8.0-pre5

* Upgrade KataGo to [1.15.1](https://github.com/lightvector/KataGo/releases/tag/v1.15.1).
* Separate the model files from *.exe for larger models including a model for human-like style.
* Add "human-style" features.
  * Compare the policies between 5kyu and 1dan, for example.
  * Play human-like moves for the specified rank.
* Warn overlooked high-policy best moves by squares on stones.
* Avoid too stupid moves in persona strategy.
* Add random pair match.
* Deleted boards are also listed in "Open recent" menu.
* Deprecate the display of preferred moves by "AIs for handicap games".
* Deprecate homemade "aggressiveness" features and rely on the native KataGo features.

Incompatibilities:

* Change the autosave format.
* Upgrade libraries (Electron 31, etc.). So you may need to do "npm install" again if you use LizGoban from the command line.

### Human-style features

Choose "Human-like Analysis" or "Human-like Play" from "Preset" menu and refer to "KataGo" section in "Help" menu for details.

Thanks to [dfannius](https://github.com/dfannius); this analysis feature is a variation of his "policy heatmap".

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), unzip it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engine:

* [KataGo 1.15.1](https://github.com/lightvector/KataGo/releases/tag/v1.15.1) (eigenavx2, opencl)
* [18 block network](https://katagotraining.org/networks/) (kata1-b18c384nbt-s9996)
* [human-trained network](https://github.com/lightvector/KataGo/releases/tag/v1.15.0) (b18c384nbt-humanv0)

You can switch KataGo versions (CPU and GPU) by [Preset] menu in LizGoban. The first run of the GPU version may take a long time (1 hour on a low-spec machine, for example) for its initial tuning. You can also choose "Human-like Analysis" or "Human-like Play" from [Preset] menu. Refer to "KataGo" section in [Help] menu for details.

### To customize it on 64bit Windows

If you want to use another network (aka. model, weights), you can simply click the Engine menu and select "Load network weights". Additionally, you can modify the `config.json` file for more flexible configuration. See README for details.

### To use it on other platforms (Mac, Linux, ...)

Download the source code and see `README.md`.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

Note that some external resources are also packaged into *.zip together with LizGoban itself. The license of LizGoban is not applied to them, of course.

* engines and neural networks: [KataGo](https://github.com/lightvector/KataGo/)
* facial stone images: [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html)
