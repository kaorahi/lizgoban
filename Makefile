extra:
	(cd build_with; make)

win: extra
	npm run build_win

lin: extra
	npm run build_lin
