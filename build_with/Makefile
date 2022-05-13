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

all: $(TARGETS)

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
