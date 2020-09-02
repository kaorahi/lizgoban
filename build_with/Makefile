DOC = extra/doc
SAMPLE = extra/sample

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
MTCH_IMG = $(DOC)/match.png
FACE_IMG = $(DOC)/faces.png
LG_CONF = $(SAMPLE)/config.json
PD_HEADER = pandoc_header
KATA_DOC = $(DOC)/KataGo/README.txt

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(MTCH_IMG) $(FACE_IMG) $(LG_CONF) $(KATA_DOC)

PANDOC = pandoc -H $(PD_HEADER)

all: $(TARGETS)

clean:
	rm -f $(TARGETS)

$(REL_NOTE): release.md $(PD_HEADER)
	$(PANDOC) $< -M pagetitle='Release Note' -o $@

$(README): ../README.md $(PD_HEADER)
	 $(PANDOC) $< -M pagetitle='README' -o $@

$(LG_CONF): config.json
	cp -f $< $@

$(SCR_IMG): ../screen.gif
	convert $<'[0]' $@

$(MTCH_IMG): ../match.png
	cp -f $< $@

$(FACE_IMG): ../faces.png
	cp -f $< $@

$(KATA_DOC): bin/win/katago/README.txt
	cp -f $< $@
