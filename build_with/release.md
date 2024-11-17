[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.8.0

Highlights:

* Upgrade KataGo to [1.15.3](https://github.com/lightvector/KataGo/releases/tag/v1.15.3).
* Separate the model files from *.exe for larger models including a model for human-like style.
* Add "human-style" features.
  * Compare the policies between 5kyu and 1dan, for example.
  * Play human-like moves for the specified rank.
* Add a new strategy "spar" to "match vs. AI". It's focused on creating skill-testing situations.
* Add a sound feature.
* Add "Open recent" to File menu.

Further updates:

* Blur ownership display. (Borrow the idea from [katrain#555](https://github.com/sanderland/katrain/issues/555).)
* Replace zone indicator with playing styles indicator.
* Add ownership distribution chart at the bottom left. (Press "x" key to enlarge it.)
* Add faint red rings around "hot" stones.
* Add thin red background for "hot" periods in winrate graph.
* Add "ambiguity of areas" (faint gray line) and "settled territories" (faint green/pink dots) to score graph.
* Warn overlooked high-policy best moves by squares on stones.
* Highlight settled areas by "v" key.
* Make long press of cursor keys smoother.
* Change playing style of persona strategy. This is still being tested and might change in the future.
* Avoid unnatural tenuki in match vs. weakened AI.
* Add random pair match.
* Detect encoding of SGF files etc.
* [Support TamaGo](https://github.com/kobanium/TamaGo).
* Deprecate the display of preferred moves by "AIs for handicap games".
* Deprecate homemade "aggressiveness" features and rely on the native KataGo features.

Incompatibilities with 0.7.*:

* Change the autosave format.
* Upgrade libraries (Electron 32, etc.). So you may need to do "npm install" again if you use LizGoban from the command line.

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

* [KataGo 1.15.3](https://github.com/lightvector/KataGo/releases/tag/v1.15.3) (eigenavx2, opencl)
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
