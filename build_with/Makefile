DOC = extra/doc
SAMPLE = extra/sample
SAMPLE_BUILTIN = $(SAMPLE)/built_in
SAMPLE_MODEL = $(SAMPLE)/custom_model
SAMPLE_KATAGO = $(SAMPLE)/custom_katago
PD_HEADER = pandoc_header

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
MTCH_IMG = $(DOC)/match.png
FACE_IMG = $(DOC)/faces.png
LG_CONF_BUILTIN = $(SAMPLE_BUILTIN)/config.json
LG_CONF_MODEL = $(SAMPLE_MODEL)/config.json
LG_CONF_KATAGO = $(SAMPLE_KATAGO)/config.json
KATA_DOC_DIR = $(DOC)/KataGo
KATA_DOC = $(KATA_DOC_DIR)/README.txt

BIN_DIR = bin
KATA_DIR = $(BIN_DIR)/win/katago
KATA_MODEL_DIR = $(BIN_DIR)/common
KATA_MODEL_FILE = $(KATA_MODEL_DIR)/katanetwork.gz
KATA_MODEL_D_FILE = $(KATA_DOC_DIR)/katanetwork_license.txt

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(MTCH_IMG) $(FACE_IMG) $(LG_CONF_BUILTIN) $(LG_CONF_MODEL) $(LG_CONF_KATAGO) $(KATA_DOC)

PANDOC = pandoc -H $(PD_HEADER)

local: $(TARGETS)

all: katago local img

clean:
	rm -f $(TARGETS)

$(DOC):
	mkdir -p $@

$(SAMPLE_BUILTIN):
	mkdir -p $@

$(SAMPLE_MODEL):
	mkdir -p $@

$(SAMPLE_KATAGO):
	mkdir -p $@

$(REL_NOTE): release.md $(PD_HEADER) $(DOC)
	$(PANDOC) $< -M pagetitle='Release Note' -o $@

$(README): ../README.md $(PD_HEADER) $(DOC)
	 $(PANDOC) $< -M pagetitle='README' -o $@

$(LG_CONF_BUILTIN): config.json $(SAMPLE_BUILTIN)
	cp -f $< $@

$(LG_CONF_MODEL): config.json $(SAMPLE_MODEL)
	ruby -pe '$$_ =~ /-model/ and $$_.gsub!(/\["built-in",\s*(.*?)\]/, %q|\1|)' $< > $@

$(LG_CONF_KATAGO): config.json $(SAMPLE_KATAGO)
	cat $< \
	| ruby -pe '$$_.gsub!(/\["built-in",\s*(.*?)\]/, %q|\1|)' \
	| ruby -rjson -e 'conf = JSON.parse(ARGF.readlines.join()); p = conf["preset"]; p.replace([z = p[0]]); z["label"] = "KataGo"; z["engine"][0] = "katago"; puts JSON.pretty_generate(conf)' \
	> $@

$(SCR_IMG): ../screen.gif $(DOC)
	convert $<'[0]' $@

$(MTCH_IMG): ../match.png $(DOC)
	cp -f $< $@

$(FACE_IMG): ../faces.png $(DOC)
	cp -f $< $@

$(KATA_DOC): $(KATA_DIR)/README.txt $(DOC)
	mkdir -p $(KATA_DOC_DIR)
	cp -f $< $@

#######################################
# katago

KATA_URL_BASE = https://github.com/lightvector/KataGo/releases/download
KATA_URL1 = $(KATA_URL_BASE)/v1.13.0/katago-v1.13.0-eigen-windows-x64.zip
KATA_URL2 = $(KATA_URL_BASE)/v1.13.0/katago-v1.13.0-eigenavx2-windows-x64.zip
KATA_URL3 = $(KATA_URL_BASE)/v1.13.0/katago-v1.13.0-opencl-windows-x64.zip
KATA_MODEL_URL = https://katagoarchive.org/g170/neuralnets/g170e-b15c192-s1672170752-d466197061.bin.gz
KATA_MODEL_D_URL = https://katagoarchive.org/g170/LICENSE.txt

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
	\wget -O $(KATA_MODEL_FILE) $(KATA_MODEL_URL)
	\wget -O $(KATA_MODEL_D_FILE) $(KATA_MODEL_D_URL)

#######################################
# facial stone images

# cf. https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html
GOISI_URL = https://www.asahi-net.or.jp/~hk6t-itu/igo/image/
GOISI_COLORS = k s
GOISI_INDICES = 4 5 7 8 9 10 11 14 15 16

img:
	mkdir -p $@
	(for c in $(GOISI_COLORS); do for i in $(GOISI_INDICES); do echo $(GOISI_URL)/goisi_$$c$$i.png; done; done) | wget -i - -P $@
