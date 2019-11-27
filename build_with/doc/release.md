LizGoban 0.2.0-pre1

Test version for developers.

### To use LizGoban + Leela Zero / KataGo on 64bit Windows immediately

Just download the all-in-one package (LizGoban-0.2.0-pre1_win_*.zip), extract it, and double-click `LizGoban *.exe`. Its file size is due to the built-in engines:

* [Leela Zero 0.17](https://github.com/leela-zero/leela-zero/releases/tag/v0.17) (CPU-only) + [15 blocks network](https://github.com/leela-zero/leela-zero/issues/2192) (a4b58a91) on 2019-11-10
* [KataGo 1.2](https://github.com/lightvector/KataGo/releases/tag/v1.2) (OpenCL) + [10 blocks network](https://github.com/lightvector/KataGo/releases/tag/v1.1) (g104-b10c128) in v1.1

You can switch them by [Preset] menu in LizGoban. Note that the first run of KataGo may take a long time (1 hour or more, for example) for its initial tuning.

### To use LizGoban with GPU, Mac, Linux, etc.

Download the source code and see `README.md`.

### Major changes from 0.1.0

* Enable quick switching of engines and weights.
* Add "personal exercise book". (experimental)
* Improve komi and autoplay features.

### Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)

