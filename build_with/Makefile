DOC = extra/doc
SAMPLE = extra/sample

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
LG_CONF = $(SAMPLE)/config.json
KATA_CONF = $(SAMPLE)/katago_gtp.cfg
HCAP_CONF = $(SAMPLE)/katago_gtp_handicap.cfg
PD_HEADER = pandoc_header

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(LG_CONF) $(KATA_CONF) $(HCAP_CONF)

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

$(KATA_CONF): katago_gtp.cfg
	cp -f katago_gtp.cfg $(KATA_CONF)

$(HCAP_CONF): katago_gtp_handicap.cfg
	cp -f katago_gtp_handicap.cfg $(HCAP_CONF)

$(SCR_IMG): ../screen.gif
	convert '../screen.gif[0]' $(SCR_IMG)
