[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.7.0

* Upgrade KataGo to [1.11.0](https://github.com/lightvector/KataGo/releases/tag/v1.11.0).
* Add items to "AI strategy". (See "Help" menu for details)
  * "persona": Randomly generate various playing styles for weak bots to avoid boredom. It also has "automatic adjustment of strength" and "virtual character system". You can input any name to generate a bot with the parameters based on its name. For example, "jowa" prefers to capture stones, "alex" likes positional plays, etc. Try various names to find your favorite opponents.
  * "pass": AI plays "pass" if there is room.
  * "swap n": AI uses either of two engines at random.
* Support the new feature ["ownershipStdev"](https://github.com/lightvector/KataGo/pull/500) in KataGo 1.10.0 (red backgrounds in the subboard), that looks like a heatmap of "KataGo's eye tracking".
* Support ["movesOwnership"](https://github.com/lightvector/KataGo/issues/608) in KataGo 1.11.0.
* Show the preferred moves by "AIs for handicap games" as the stronger/weaker side. (small blue up/down triangles on the board, sharpness of the triangles in the winrate bar)
* Add automatic adjustment for [[SGF from Image]](http://kaorahi.github.io/lizgoban/src/sgf_from_image/sgf_from_image.html).
* Add "Auto overview" into Tool menu so that one can turn it off.
* Add "Preferences" into Edit menu for convenience.
* Slightly improve bogus territory counts.
* Slightly improve ladder continuation.
* Use change of ownership in addition to ownership itself for facial stones.
* Guess the rule from komi if RU (rule) property is missing in SGF.
* Officially support tsumego frame and ladder continuation.
* Fix SSL issue on Let's Encrypt. ([ref](https://github.com/electron/electron/issues/31212) [ref](https://github.com/electron/electron/pull/31213))
* The keyboard shortcuts "0" to "9" are deleted for match vs. AI with obsolete strategies.

Incompatibilities:

* Upgrade libraries (Electron 18, etc.). So you may need to do "npm install" again.

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), unzip it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engine:

* [KataGo 1.11.0](https://github.com/lightvector/KataGo/releases/tag/v1.11.0) (eigen, eigenavx2, opencl) + [15 block network](https://katagotraining.org/networks/) (g170e-b15c192-s1672 from [KataGo 1.4.5](https://github.com/lightvector/KataGo/releases/tag/v1.4.5))

You can switch KataGo versions (CPU, modern CPU, GPU) by [Preset] menu in LizGoban. The first run of the GPU version may take a long time (1 hour on a low-spec machine, for example) for its initial tuning.

### To customize it on 64bit Windows

If you want to use other engines, network files, options, ...

1. Prepare engines (Leela Zero and/or KataGo) and their network files (aka. weights, models) by yourself, if necessary.
2. Download and unzip the same all-in-one package as above.
3. Copy sample/config.json to the same folder as `LizGoban *.exe` and edit it. See README for its format.

### To use it on other platforms (Mac, Linux, ...) or Windows with more flexible configuration

Download the source code and see `README.md`.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

Note that some external resources are also packaged into *.exe together with LizGoban itself. The license of LizGoban is not applied to them, of course.

* engines and neural networks: [KataGo](https://github.com/lightvector/KataGo/)
* facial stone images: [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html)
