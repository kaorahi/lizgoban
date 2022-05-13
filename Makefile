local:
	(cd build_with; make)

extra:
	(cd build_with; make all)

win: extra
	npm i
	npm run build_win

lin: extra
	npm i
	npm run build_lin
