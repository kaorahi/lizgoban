DOC = extra/doc
SAMPLE = extra/sample
PD_HEADER = pandoc_header

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
MTCH_IMG = $(DOC)/match.png
FACE_IMG = $(DOC)/faces.png
LG_CONF = $(SAMPLE)/config.json
KATA_DOC = $(DOC)/KataGo/README.txt

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(MTCH_IMG) $(FACE_IMG) $(LG_CONF) $(KATA_DOC)

PANDOC = pandoc -H $(PD_HEADER)

local: $(TARGETS)

all: bin local img

clean:
	rm -f $(TARGETS)

$(DOC):
	mkdir -p $@/KataGo

$(SAMPLE):
	mkdir -p $@

$(REL_NOTE): release.md $(PD_HEADER) $(DOC)
	$(PANDOC) $< -M pagetitle='Release Note' -o $@

$(README): ../README.md $(PD_HEADER) $(DOC)
	 $(PANDOC) $< -M pagetitle='README' -o $@

$(LG_CONF): config.json $(SAMPLE)
	cp -f $< $@

$(SCR_IMG): ../screen.gif $(DOC)
	convert $<'[0]' $@

$(MTCH_IMG): ../match.png $(DOC)
	cp -f $< $@

$(FACE_IMG): ../faces.png $(DOC)
	cp -f $< $@

$(KATA_DOC): bin/win/katago/README.txt $(DOC)
	cp -f $< $@

#######################################
# katago

KATA_DIR = win/katago
KATA_URL1 = https://github.com/lightvector/KataGo/releases/download/v1.11.0/katago-v1.11.0-eigen-windows-x64.zip
KATA_URL2 = https://github.com/lightvector/KataGo/releases/download/v1.11.0/katago-v1.11.0-eigenavx2-windows-x64.zip
KATA_URL3 = https://github.com/lightvector/KataGo/releases/download/v1.11.0/katago-v1.11.0-opencl-windows-x64.zip
KATA_MODEL_URL = https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b15c192-s1672170752-d466197061.txt.gz

bin:
	mkdir -p $@/common $@/$(KATA_DIR)
	\wget -O tmp_kata1.zip $(KATA_URL1)
	\wget -O tmp_kata2.zip $(KATA_URL2)
	\wget -O tmp_kata3.zip $(KATA_URL3)
	unzip -o tmp_kata1.zip -d $@/$(KATA_DIR) && cd $@/$(KATA_DIR) && mv katago.exe katago-eigen.exe
	unzip -o tmp_kata2.zip -d $@/$(KATA_DIR) && cd $@/$(KATA_DIR) && mv katago.exe katago-eigenavx2.exe
	unzip -o tmp_kata3.zip -d $@/$(KATA_DIR) && cd $@/$(KATA_DIR) && mv katago.exe katago-opencl.exe
	cd $@/common; \wget -O katanetwork.txt.gz $(KATA_MODEL_URL)

#######################################
# facial stone images

# cf. https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html
GOISI_URL = https://www.asahi-net.or.jp/~hk6t-itu/igo/image/
GOISI_COLORS = k s
GOISI_INDICES = 4 5 7 8 9 10 11 14 15 16

img:
	mkdir -p $@
	(for c in $(GOISI_COLORS); do for i in $(GOISI_INDICES); do echo $(GOISI_URL)/goisi_$$c$$i.png; done; done) | wget -i - -P $@
