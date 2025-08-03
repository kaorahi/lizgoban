[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.9.1-pre1

* Upgrade KataGo to [1.16.3](https://github.com/lightvector/KataGo/releases/tag/v1.16.3).
* Enable policy comparison between "human-style" and KataGo. (In the all-in-one package for Windows, select "Human-like Analysis" from "Preset" menu, and "Preferences" from "Edit" menu.)
* Upgrade libraries (Electron 37, etc.). So you may need to do "npm install" again if you use LizGoban from the command line.

## LizGoban 0.9.0

Highlights:

* Upgrade KataGo to [1.16.0](https://github.com/lightvector/KataGo/releases/tag/v1.16.0).
* Add visualization of AI's search tree. (`Tool > Plot MCTS tree`) [sample](https://kaorahi.github.io/visual_MCTS/)
* Add rank estimation feature if a human model is available:
  * rank estimation (9d, 3d, 1k, 6k, or 15k, by default. Check `Edit > Preferences > Finer dan/kyu scan` for finer but slower estimation.)
  * each rank's preferences in the winrate graph
  * automatic adjustment of the human-style profile in match vs. AI.
* [Experimental] Show the search tree for ["if players try to capture/rescue this stone"](https://github.com/lightvector/KataGo/issues/1031#issuecomment-2746727449) by shift + double-click. You need to specify KataGo's option `-human-model` for good results. (In the all-in-one package for Windows, choose "Human-like Analysis" from "Preset" menu.) [ref](https://github.com/kaorahi/visual_MCTS/tree/master/sample4)

Further updates:

* Add board and stone images to the all-in-one package for Windows.
* Add board position copy-paste.
  1. Alt+drag to select the source region.
  2. `Edit > Flip / rotate / etc. > copy stones`
  3. Alt+drag to select the destination region.
  4. `Edit > Flip / rotate / etc. > paste`
* Add tsumego frame without ko threats. (`Tool > Tsumego frame`)
* Add "Next move quiz" to View menu.

Incompatibilities with 0.8.*:

* Upgrade libraries (Electron 36, etc.). So you may need to do "npm install" again if you use LizGoban from the command line.

### Human-style features

Choose "Human-like Analysis" or "Human-like Play" from "Preset" menu and refer to "KataGo" section in "Help" menu for details.

Thanks to [dfannius](https://github.com/dfannius); this analysis feature is a variation of his "policy heatmap".

You can also play against the "spar" AI. Designed for practice, it focuses not on winning but on creating skill-testing situations for players of specific DAN or KYU ranks. Let's knock it out!

1. From "Preset" menu, choose "Human-like Play". ("Human-like Analysis" is also ok.)
2. From "File" menu, choose "Match vs. AI".
3. Select "spar" in "vs." pulldown menu.
4. Adjust the profile slider. (20k-9d)
5. Click the board to place the first black stone, or click "start AI's turn" button to let the AI play black.

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), unzip it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engine:

* [KataGo](https://github.com/lightvector/KataGo/releases/) (eigenavx2, opencl)
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
* stone sounds: extracted from [OmnipotentEntity's Discord post](https://discord.com/channels/417022162348802048/417038123822743552/1251545825226526792)
