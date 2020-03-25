DOC = extra/doc
SAMPLE = extra/sample

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
LG_CONF = $(SAMPLE)/config.json
KATA_CONF_SRC = katago_gtp.cfg
KATA_CONF = $(SAMPLE)/$(KATA_CONF_SRC)
PD_HEADER = pandoc_header

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(LG_CONF) $(KATA_CONF_SRC) $(KATA_CONF)

PANDOC = pandoc -H $(PD_HEADER)

all: $(TARGETS)

clean:
	rm -f $(TARGETS)

$(REL_NOTE): release.md $(PD_HEADER)
	$(PANDOC) -M pagetitle='Release Note' release.md > $(REL_NOTE)

$(README): ../README.md $(PD_HEADER)
	 $(PANDOC) -M pagetitle='README' ../README.md > $(README)

$(LG_CONF): config.json
	cp -f config.json $(LG_CONF)

$(KATA_CONF): $(KATA_CONF_SRC)
	cp -f $(KATA_CONF_SRC) $(KATA_CONF)

$(KATA_CONF_SRC): src/gtp_example.cfg src/katago_gtp.patch
	cp -f src/gtp_example.cfg $(KATA_CONF_SRC)
	patch --no-backup-if-mismatch $(KATA_CONF_SRC) src/katago_gtp.patch

$(SCR_IMG): ../screen.gif
	convert '../screen.gif[0]' $(SCR_IMG)
