# SGF from Image

This is a semiautomatic converter from diagram images of the game Go (Weiqi, Baduk) to SGF format. Try an [online demo](http://kaorahi.github.io/lizgoban/src/sgf_from_image/sgf_from_image.html).

The contents of this directory will work independent of [LizGoban](https://github.com/kaorahi/lizgoban) if you just put them on a web server. Using them locally without a web server is troublesome because image accesses are refused by security mechanisms of web browsers.

(Example of local testing)

~~~
cd lizgoban
python -m SimpleHTTPServer
firefox http://localhost:8000/src/sgf_from_image/sgf_from_image.html
~~~
