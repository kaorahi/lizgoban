RELEASE = 241117b

VERSION = $(shell grep '"version"' package.json | cut -d '"' -f 4)
EXE = dist/LizGoban\ $(VERSION).exe
PACKAGE = tmpLizGoban-$(VERSION)_win_$(RELEASE)
ZIP = tmp$(PACKAGE).zip

local:
	(cd build_with; make)

extra:
	(cd build_with; make all)

$(EXE):
	npm i
	npm run build_win

# force rebuilding
win: extra
	npm i
	npm run build_win

lin: extra
	npm i
	npm run build_lin

######################################
# zip

$(PACKAGE): extra $(EXE)
	mkdir $(PACKAGE)
	cp $(EXE) build_with/config.json $(PACKAGE)
	cp -r build_with/bin/win/katago $(PACKAGE)
	cp build_with/bin/common/katanetwork.gz $(PACKAGE)/katago/default_model.bin.gz
	cp build_with/bin/common/kata_humanmodel.gz $(PACKAGE)/katago/human_model.bin.gz
	cp -r build_with/extra/* $(PACKAGE)

$(ZIP): $(PACKAGE)
	cd $(PACKAGE) && zip -r $(PACKAGE).zip . && mv $(PACKAGE).zip ..

zip: $(ZIP)
