DOC = extra/doc
SAMPLE = extra/sample

README = $(DOC)/README.html
REL_NOTE = $(DOC)/release.html
SCR_IMG = $(DOC)/screen.gif
AREA_IMG = $(DOC)/area_count.png
LG_CONF = $(SAMPLE)/config.json
KATA_CONF = $(SAMPLE)/katago_gtp.cfg

TARGETS = $(README) $(REL_NOTE) $(SCR_IMG) $(AREA_IMG) $(LG_CONF) $(KATA_CONF)

all: $(TARGETS)

clean:
	rm -f $(TARGETS)

$(REL_NOTE): release.md
	pandoc release.md > $(REL_NOTE)

$(README): ../README.md
	pandoc ../README.md > $(README)

$(LG_CONF): config.json
	cp -f config.json $(LG_CONF)

$(KATA_CONF): katago_gtp.cfg
	cp -f katago_gtp.cfg $(KATA_CONF)

$(SCR_IMG): ../screen.gif
	convert '../screen.gif[0]' $(SCR_IMG)

$(AREA_IMG): ../area_count.png
	cp -f ../area_count.png $(AREA_IMG)
