# LizGoban - Leela Zero & KataGo visualizer

LizGoban is an analysis tool of the game Go with
[Leela Zero](https://github.com/gcp/leela-zero)
and [KataGo](https://github.com/lightvector/KataGo).
It is an implementation of
[Lizzie](https://github.com/featurecat/lizzie)-style real-time UI
on [Electron](https://electronjs.org/).

<img src="screen.gif" width="45%"> <img src="match.png" width="50%">

<img src="faces.png" width="40%">

(Facial stone images from [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html))

## Highlights

1. Engines do not tell the reason of suggestions. So LizGoban aims at a GUI for easy trial of what-if in addition to quick browse of proposed variations. For example, you can use any number of trial boards in parallel, discard a needless one by a single action, and restore the deleted one if necessary.
2. Engine's suggestions are not 100% reliable, of course. We hope to get some signs when the suggested moves are unreliable. LizGoban visualizes convergence and consistency of estimations for this purpose. We can notice the case when we should wait for a little more analysis, and will never miss a new rising candidate like the one in the above screenshot.
3. Though Lizzie is amazingly useful, its setup is not easy for many Go players because it needs Java. In this project, the core feature of Lizzie is transported to JavaScript so that they can taste the joy of real-time analysis. The all-in-one package of LizGoban works immediately out of the box without installation, configuration, additional downloads, and so on.
4. Flexibility of JavaScript also enables quick experiments of fun ideas that bring various original features as follows.

## Features

### Common features

* Colored suggestions / Variation by mouse hover
* Plots of winrate and estimated score
* Subboard that always shows the principal variation
* Blunder marks on stones
* Auto-replay / Auto-analysis
* Quick switching of multiple engines
* Open URL (by drag & drop or clipboard)
* Save/load analyses to/from SGF in Lizzie-compatible format
* [Experimental] Use your favorite images for the board and the stones

### Original features

* Trial boards that can be used like tabs in web browsers
* Play against weakened engines in several ways
* Watch Leela Zero vs. KataGo etc. with real-time comparison of their plans
* Personal exercise book that can be used like bookmarks in web browsers for random exercise
* Quick comparison of stones, ownerships, and areas of the current and past boards
* Let-me-think-first mode in autoplay: plain board for n seconds and then suggestions for n seconds in each move

### Original visualizations

* Visualization of search progress via plots of visits, winrate, score, prior, ... for each suggested move
* Real-time display of area counts by KataGo
* Analysis of gains and losses in recent moves on the board that reveals overlooked side effects
* Highlighting of unexpected good moves that are overlooked by engines
* Detection of inconsistency between analyses before/after a move as a check of their reliability
* Additional plots
  * cumulative score-losses by black and white that indicate mistakes of each player separately
  * ambiguity of life & death that indicates big fights, game stages (opening / middlegame / endgame), etc.
* Indicators that suggest highlight scenes of the game (ko fights, played zones)
* Translucent stones for too long variations as the above screenshot
* Ownerships of stones by facial expressions

## Usage

### Case I: 64bit Windows without GPU

Just download the [all-in-one package](https://github.com/kaorahi/lizgoban/releases). You can use it immediately without installation, configuration, additional downloads, etc.

### Case II: 64bit Windows with GPU

[BadukMegapack by wonsiks](https://github.com/wonsiks/BadukMegapack)
may be the easiest way to install LizGoban together with many other tools.
(Though it is not tested by the author of LizGoban,
who does not have a Windows machine.)

Otherwise, see the release note to replace the built-in engines with GPU versions in Case I or follow the steps in Case III.

### Case III: Other platforms (Mac, Linux, ...) or Windows with more flexible configuration

#### To use it:

1. Install [Node.js](https://nodejs.org/).
2. Type `git clone https://github.com/kaorahi/lizgoban; cd lizgoban; npm install` on a terminal.
3. Put Leela Zero binary (version 0.17 or later) as `external/leelaz` together with its network weight as `external/network.gz`.
4. Type `npm start`. (Windows: Double-click `lizgoban_windows.vbs`.)

Use `npm start -- --no-sandbox` if you get an error like "The SUID sandbox helper binary was found, but is not configured correctly" and you do not want to fix it.

#### To configure it:

Start it as

    npm start -- -c config.json

with the file config.json:

    {"sgf_dir": "/foo/bar/sgf/"}

(Windows: Put the above config.json into the same folder as lizgoban_windows.vbs and double-click lizgoban_windows.vbs.)

Here is a more practical example of config.json for Leela Zero 0.17 and KataGo 1.4.4.

~~~~
{
    "analyze_interval_centisec": 20,
    "autosave_deleted_boards": 5,
    "autosave_sec": 300,
    "sgf_dir": "/foo/bar/sgf/",
    "exercise_dir": "/foo/bar/exercise/",
    "max_cached_engines": 3,
    "preset": [
        {
            "label": "Leela Zero",
            "accelerator": "F1",
            "engine": ["/foo/bar/leelaz", "-g", "-w", "/foo/lz_net/254.gz"]
        },
        {
            "label": "KataGo",
            "accelerator": "F2",
            "engine": ["/foo/bar/katago", "gtp",
                       "-override-config", "analysisPVLen=50, defaultBoardSize=19",
                       "-model", "/foo/kata_net/g104-b20c256.gz",
                       "-config", "/foo/bar/gtp.cfg"]
        },
        {
            "label": "KataGo (handicap)",
            "match": true, "rules": "tromp-taylor", "komi": 0, "handicap": 5,
            "stone_style": "2D",
            "engine": ["/foo/bar/katago", "gtp",
                       "-override-config",
                       "analysisPVLen=50, defaultBoardSize=19, dynamicPlayoutDoublingAdvantageCapPerOppLead=0.00, playoutDoublingAdvantage=2.00",
                       "-model", "/foo/kata_net/g104-b20c256.gz",
                       "-config", "/foo/bar/gtp.cfg"]
        },
        {
            "label": "LZ",
            "label_for_white": "KATA",
            "empty_board": true,
            "engine": ["/foo/bar/leelaz", "-g", "-w", "/foo/lz_net/254.gz"],
            "engine_for_white": ["/foo/bar/katago", "gtp",
                       "-model", "/foo/kata_net/g104-b20c256.gz",
                       "-config", "/foo/bar/gtp.cfg"]
        },
        {"label": "Hide hints", "accelerator": "F3", "board_type": "raw"},
        {"label": "Show hints", "accelerator": "F4", "board_type": "double_boards"}
    ]
}
~~~~

* analyze_interval_centisec: Update interval of analysis display (1 = 0.01sec).
* autosave_deleted_boards: Maximum number of deleted boards that are kept across sessions.
* autosave_sec: Auto-save frequency (1 = 1sec).
* sgf_dir: Default directory for [Open SGF] and [Save SGF] menus. (*1)
* exercise_dir: Directory for your personal exercise book. (*1)
* max_cached_engines: Maximum number of simultaneous engine processes. You can set this as 5 for quicker switch of 5 different engines / weights, for example, if your machine has enough spec.
* preset: You can switch the given settings by [Preset] menu in LizGoban. The first one is used as default.
  * label: Item name shown in [Preset] menu.
  * accelerator: Shortcut key like "Shift+F3", "CmdOrCtrl+F4", "Alt+F5", etc. It can be omitted as the above "LZ vs. KATA".
  * engine: Engine command. (*1)
  * engine_for_white: Alternative engine is used for white if this is set. (*1)
  * label_for_white: Additional item name when engine_for_white is given.
  * empty_board: Set it true for creating new empty board.
  * rules: See the comments for "rules" in gtp_example.cfg of KataGo.
  * komi: 7.5, 6.5, 0, -0.5, etc. (for KataGo)
  * handicap: Number of handicap stones.
  * match: Set it true for match vs. AI.
  * board_type: One of "double_boards", "double_boards_raw", "double_boards_swap", "double_boards_raw_pv", "raw", "suggest", "variation", "winrate_only". See [View] menu for their appearances.
  * stone_style: One of "2D", "2.5D", "3D", or "Face". (You need to set "face_image_rule" for "Face". See the next section.)

(*1) In these items, you can use relative paths from the "working directory", that is the folder of `LizGoban*.exe` itself in the all-in-one package or `external/` otherwise. For example, you can simply write "leelaz" for `external/leelaz`.

It is recommended to put all Leela Zero weights into one directory and all KataGo weights into another directory for using [Load network weights] menu conveniently.
Delete obsolete "weight_dir" in your config.json if you wrote it.

Notes on KataGo:
For high handicap games, you have to set `playoutDoublingAdvantage` by hand because LizGoban cannot use KataGo's dynamical adjusting of aggressiveness at present. After KataGo 1.3.4, you can add `defaultBoardSize=19` as the above example to shorten the initialization of 9x9 and 13x13. ("=19" is ok. It is replaced with 9 or 13 inside LizGoban automatically.)

For quick experiments, you can also use

    npm start -- -j '{"sgf_dir": "/foo/bar/baz/"}'
    npm start -- -c config.json -j '{"sgf_dir": "/foo/bar/baz/"}'
    etc.

on Mac or Linux. The latter option overwrites the former one in the second example.

In addition, LizGoban reads external/config.json (and config.json in the "working directory" in the above (*1)) beforehand if they exist.

#### To show ownerships of stones by facial expressions:

Prepare stone images and put them into `external/` directory.
For example, images in [Goisisan](https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html) are used in the above screenshot.

Then add "face_image_rule" into config.json like this.

~~~~
{
    ...
    "face_image_rule": [
        [-0.8, "goisi_k4.png", "goisi_s4.png"],
        [-0.6, "goisi_k15.png", "goisi_s15.png"],
        [-0.4, "goisi_k8.png", "goisi_s8.png"],
        [-0.2, "goisi_k9.png", "goisi_s9.png"],
        [0.00, "goisi_k7.png", "goisi_s7.png"],
        [0.30, "goisi_k11.png", "goisi_s11.png"],
        [0.60, "goisi_k5.png", "goisi_s5.png"],
        [0.90, "goisi_k10.png", "goisi_s10.png"],
        [0.95, "goisi_k14.png", "goisi_s14.png"],
        [1.00, "goisi_k16.png", "goisi_s16.png"]
    ],
    ...
}
~~~~

It means

* goisi_k4.png (black) or goisi_s4.png (white) for ownership < -0.8 (dead).
* goisi_k15.png or goisi_s15.png for ownership < -0.6.
* ...
* goisi_k16.png or goisi_s16.png for ownership <= 1.00 (alive).

Set KataGo as the engine and select View > Stone > Face. You need to enable View > Ownership if you have disabled it.

#### To replace images of board and stones (Experimental)

Put your favorite images of board and stones as `external/board.png`, `external/black.png`, and `external/white.png` (before starting LizGoban).

## Major changes

### 0.5.0-pre*

* Support ownerships of stones by facial expressions.
* Support `*.gib`, `*.ngf`, `*.ugf`, and `*.ugi` in addition to `*.sgf`.
* Modify "File" menu slightly for convenience.
* Officially support reuse of analyses like Lizzie.
* Add "Save/Copy SGF with analysis" into menu. (compatible with Lizzie 0.7.2)
* Add more configurations (rules, komi, handicap, stone_style) into `preset` in `config.json`.
* Omit marks for too minor suggestions on the board.
* Automatically start quick overview after reading SGF.
* Experimentally add "Tool > Experimental > Tsumego" for solving life & death problems. (See "Tips" section in "Help" menu.)
* Improve display by "c" key + mouse hover on existing stones.
* Borrow some ideas from [KaTrain](https://github.com/sanderland/katrain/).
** Show mistakes and actually punished scores on stones.
** Click on a stone to temporarily show the past board.
** Double-click on a stone to jump to the move.

Incompatibilities:
* Upgrade libraries (Electron 9, etc.). So you may need to do "npm install" again.

### 0.4.0

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

### 0.3.*

* Open URL by drag & drop or clipboard.
* Count stones separately in area counts. (See "KataGo" section in "Help" menu.)
* Flip & rotate the board randomly in exercise.

### 0.2.0

* Add "preset" to switch engines inside LizGoban.
* Add "max_cached_engines" for quicker switch of engines / weights.
* Enable autoplay between different engines.
* Add "personal exercise book".
* Improve komi features.
* The format of config.json is modified. (The obsolete format also works at present.)
* Some items are moved to [Engine] menu.

### 0.1.0

* The all-in-one package (*.exe) is offered for Windows.
* The launcher command is changed from "npx electron src" to "npm start".
* "Load engine" menu is deleted because it is misleading.

## Links

[Project Home](https://github.com/kaorahi/lizgoban) /
[License (GPL3)](https://github.com/kaorahi/lizgoban/blob/master/LICENSE.txt)
