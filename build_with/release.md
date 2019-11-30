LizGoban 0.2.0-pre3

Test version for skilled users.

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), extract it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engines:

* [Leela Zero 0.17](https://github.com/leela-zero/leela-zero/releases/tag/v0.17) (CPU-only) + [15 blocks network](https://github.com/leela-zero/leela-zero/issues/2192) (a4b58a91) on 2019-11-10
* [KataGo 1.2](https://github.com/lightvector/KataGo/releases/tag/v1.2) (OpenCL) + [10 blocks network](https://github.com/lightvector/KataGo/releases/tag/v1.1) (g104-b10c128) in v1.1

You can switch them by [Preset] menu in LizGoban. The first run of KataGo may take a long time (1 hour or more, for example) for its initial tuning.

### To customize it on 64bit Windows (Leela Zero with GPU, KataGo in Japanese rule, ...)

1. Prepare engines (Leela Zero and/or KataGo) by yourself, if necessary.
2. Download and extract the same all-in-one package as above.
3. Copy sample/config.json to the same folder as `LizGoban *.exe` and edit it. See [README.html](README.html) for its format.

Note that the built-in KataGo is the official binary. You may need to get another unofficial binary (from [Lizzie](https://github.com/featurecat/lizzie/releases) etc.) to use Japanese rule.

### To use it on other platforms (Mac, Linux, ...) or Windows with more flexible configuration

Download the source code and see `README.md`.

### Changes from 0.2.0-pre1

* Enable configuration of the all-in-one package.
* Enable "personal exercise book" features in [Tool] menu by default. See "Tips" section of [Help] menu for usage.
* Fix: KataGo tuner ran every time in the all-in-one package in pre1. It was fixed in pre2.

### Major changes from 0.1.0

* Enable quick switching of engines and weights by a new format of config.json.
* Add "personal exercise book".
* Improve komi and autoplay features.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)
