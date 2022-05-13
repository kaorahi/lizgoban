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

all: local img

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
# facial stone images

# cf. https://www.asahi-net.or.jp/~hk6t-itu/igo/goisisan.html
GOISI_URL = https://www.asahi-net.or.jp/~hk6t-itu/igo/image/
GOISI_COLORS = k s
GOISI_INDICES = 4 5 7 8 9 10 11 14 15 16

img:
	mkdir -p $@
	(for c in $(GOISI_COLORS); do for i in $(GOISI_INDICES); do echo $(GOISI_URL)/goisi_$$c$$i.png; done; done) | wget -i - -P $@
