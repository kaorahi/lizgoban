DOC = extra/doc
SAMPLE = extra/sample
PD_HEADER = pandoc_header

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
MTCH_IMG = $(DOC)/match.png
FACE_IMG = $(DOC)/faces.png
KATA_DOC_DIR = $(DOC)/KataGo

BIN_DIR = bin
KATA_DIR = $(BIN_DIR)/win/katago
KATA_MODEL_DIR = $(BIN_DIR)/common
KATA_MODEL_FILE = $(KATA_MODEL_DIR)/katanetwork.gz
KATA_MODEL_D_FILE = $(KATA_DOC_DIR)/katanetwork_license.txt

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(MTCH_IMG) $(FACE_IMG)

PANDOC = pandoc -H $(PD_HEADER)

local: $(TARGETS)

all: katago local img

clean:
	rm -f $(TARGETS)

$(DOC):
	mkdir -p $@

$(REL_NOTE): release.md $(PD_HEADER) $(DOC)
	$(PANDOC) $< -M pagetitle='Release Note' -o $@

$(README): ../README.md $(PD_HEADER) $(DOC)
	 $(PANDOC) $< -M pagetitle='README' -o $@

$(SCR_IMG): ../screen.gif $(DOC)
	convert $<'[0]' $@

$(MTCH_IMG): ../match.png $(DOC)
	cp -f $< $@

$(FACE_IMG): ../faces.png $(DOC)
	cp -f $< $@

#######################################
# katago

KATA_URL_BASE = https://github.com/lightvector/KataGo/releases/download
KATA_URL1 = $(KATA_URL_BASE)/v1.14.0/katago-v1.14.0-eigen-windows-x64.zip
KATA_URL2 = $(KATA_URL_BASE)/v1.14.0/katago-v1.14.0-eigenavx2-windows-x64.zip
KATA_URL3 = $(KATA_URL_BASE)/v1.14.0/katago-v1.14.0-opencl-windows-x64.zip
KATA_MODEL_URL = https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz
KATA_MODEL_D_URL = https://katagotraining.org/network_license/

katago: $(KATA_DIR) $(KATA_MODEL_FILE)

$(KATA_DIR):
	mkdir -p $@
	\wget -O tmp_kata1.zip $(KATA_URL1)
	\wget -O tmp_kata2.zip $(KATA_URL2)
	\wget -O tmp_kata3.zip $(KATA_URL3)
	unzip -o tmp_kata1.zip -d $@ && cd $@ && mv katago.exe katago-eigen.exe
	unzip -o tmp_kata2.zip -d $@ && cd $@ && mv katago.exe katago-eigenavx2.exe
	unzip -o tmp_kata3.zip -d $@ && cd $@ && mv katago.exe katago-opencl.exe

$(KATA_MODEL_FILE):
	mkdir -p $(KATA_MODEL_DIR)
	mkdir -p $(KATA_DOC_DIR)
	\wget -O $(KATA_MODEL_FILE) $(KATA_MODEL_URL)
	\wget -O - $(KATA_MODEL_D_URL) | pandoc -f html -t plain -o $(KATA_MODEL_D_FILE)

#######################################
# facial stone images

# cf. https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html
GOISI_URL = https://www.asahi-net.or.jp/~hk6t-itu/igo/image/
GOISI_COLORS = k s
GOISI_INDICES = 4 5 7 8 9 10 11 14 15 16

img:
	mkdir -p $@
	(for c in $(GOISI_COLORS); do for i in $(GOISI_INDICES); do echo $(GOISI_URL)/goisi_$$c$$i.png; done; done) | wget -i - -P $@
