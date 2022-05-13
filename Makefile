local:
	(cd build_with; make)

extra:
	(cd build_with; make all)

win: extra
	npm run build_win

lin: extra
	npm run build_lin
