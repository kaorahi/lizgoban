# LizGoban - Yet another Leela Zero GUI

LizGoban is an analysis tool of the game Go with
[Leela Zero](https://github.com/gcp/leela-zero).
It is an implementation of
[Lizzie](https://github.com/featurecat/lizzie)-style real-time UI on Electron.

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

To try it:

1. Install Node.js and type "npm install electron @sabaki/sgf".
2. Put Leela Zero binary as src/leelaz and its network weight as src/network.
3. Type "npx electron src".

[Project Home](https://github.com/kaorahi/lizgoban)
