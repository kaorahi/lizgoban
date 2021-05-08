[comment]: # -*- coding: utf-8 -*-

# Release notes

## LizGoban 0.6.1

* Add import of diagram images.

You can copy a diagram image and paste it onto LizGoban by Ctrl+V (Edit > Paste) or drag & drop to import the positions of the stones.

This is very low-tech. You may need parameter tuning or manual correction for photographic/reflective images and marked/numbered/glossy stones. But it is still usable for many tsumego pictures on the Internet and many YouTube screenshots. You can also try [[Online version of "SGF from Image"]](http://kaorahi.github.io/lizgoban/src/sgf_from_image/sgf_from_image.html).

* Fix minor bugs.

# (Previous versions)

## LizGoban 0.6.0

* Upgrade KataGo to [1.8.1](https://github.com/lightvector/KataGo/releases/tag/v1.8.1).
* Indicate inevitability of each move by its font size in suggested variations (KataGo only).
* Show X mark on suggested variations when it is updated in the background.
* Improve loading of nested SGFs, e.g. [AlphaGo Games](https://deepmind.com/alphago-games-english), so that we can read them conveniently:
  * Push the corresponding key (d, e, ...) for each branch (d, e, ... in dotted squares) to preview its sequence with comments.
  * Click one of branches (or hit Enter key in the above preview) to watch it in another trial board.
  * Click "x" mark at the right top of the board to close it and return to the main branch.
* Implement side by side comparisons of the principal variation and the actual succeeding moves, etc.
* Add stars to personal exercise book. Starred exercises will appear more often.
* Support restriction of analysis region by Alt+drag like [KaTrain](https://github.com/sanderland/katrain/).
* Slightly improve Tsumego frame (boundary, analysis region).
* Insert/delete moves in the middle of the game by Ctrl+Shift+click.
* Insert a black (white) stone by b(w)+click.
* Add pair Go to "File" menu and `preset` in `config.json`.
* Add "resize to 19x19" into "Flip..." in "Edit" menu.
* Copy SGF comments to the clipboard when they are clicked.
* Accelerate quick overview.
* Automatically mark ladder breakers as "=" and [show the continuation of the ladder](https://github.com/kaorahi/lizgoban/issues/63) by "=" key (experimental).
* Experimentally support [external control of LizGoban](https://github.com/kaorahi/lizgoban/issues/61) from another program.
* Fix minor bugs.

Incompatibilities:

* Upgrade libraries (Electron 11, etc.). So you may need to do "npm install" again.

### To use it on 64bit Windows immediately

Just download the all-in-one package (`LizGoban-*_win_*.zip`), unzip it, and double-click `LizGoban *.exe`. You do not need installation, configuration, additional downloads, and so on. Its file size is due to the built-in engine:

* [KataGo 1.8.1](https://github.com/lightvector/KataGo/releases/tag/v1.8.1) (eigen, eigenavx2, opencl) + [15 blocks network](https://d3dndmfyhecmj0.cloudfront.net/g170/neuralnets/index.html) (g170e-b15c192-s1672 from [KataGo 1.4.5](https://github.com/lightvector/KataGo/releases/tag/v1.4.5))

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
