# LizGoban - Attachable Leela Zero GUI

LizGoban is an analysis tool of the game Go with
[Leela Zero](https://github.com/gcp/leela-zero).
It is an implementation of
[Lizzie](https://github.com/featurecat/lizzie)-style real-time UI
on [Electron](https://electronjs.org/).
Instead of having a full-featured board editor by itself,
it is attachable to [Sabaki](https://sabaki.yichuanshen.de/)
as subwindows.

![screenshot](screen.png)

Though Lizzie is amazingly useful, its setup is not easy
for many Go players because it needs Java.
In this project, the core feature of Lizzie is transported to JavaScript
so that they can taste the joy of real-time analysis.

It works already.

* Colored suggestions
* Variation by mouse hover
* Subboard that always shows the principal variation

Help needed:

* Graphic design
* Windows support

To try it (stand alone):

1. Install [Node.js](https://nodejs.org/) and type "npm install electron electron-config socket.io @sabaki/sgf".
2. Build unreleased Leela Zero in "next" branch (or copy leelaz.exe in Lizzie-0.5 for Windows).
3. Put Leela Zero binary as src/leelaz together with its network weight as src/network.
3. Type "npx electron src".

To attach it to Sabaki:

1. Build a customized Sabaki as follows.
  * Get the source code of Sabaki.
  * Type "npm install socket.io-client".
  * Apply the patch "sabaki/send_treepos.patch" and build Sabaki.
2. Start LizGoban and Sabaki.
3. Click "attach to sabaki" button on LizGoban.
3. Put a stone on Sabaki and see it appears on LizGoban.

[Project Home](https://github.com/kaorahi/lizgoban)
