// Dewey Decimal Classification — the three DDC summaries (10 main classes,
// 100 divisions, 1000 sections). Headings are abridged to fit the UI.
// Used for the shelf order, the class picker, and the in-app DDC guide.
// Section lists are keyed by division prefix ("00" -> 000–009); an empty string
// marks a section number that is unassigned / no longer used.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DEWEY = factory();
})(typeof self !== "undefined" ? self : this, () => {
  const S = {
    "00": ["Computer science, knowledge & systems", "Knowledge", "The book", "Systems", "Data processing & computer science", "Computer programming, programs & data", "Special computer methods", "", "", ""],
    "01": ["Bibliographies", "Bibliographies of individuals", "Bibliographies of works by specific classes of authors", "", "Bibliographies of anonymous & pseudonymous works", "Bibliographies of works from specific places", "Bibliographies of works on specific subjects", "General subject catalogs", "Catalogs arranged by author, main entry, date, etc.", "Dictionary catalogs"],
    "02": ["Library & information sciences", "Library relationships", "Administration of physical plant", "Personnel management", "", "Library operations", "Libraries for specific subjects", "General libraries", "Reading & use of other information media", ""],
    "03": ["General encyclopedic works", "Encyclopedias in American English", "Encyclopedias in English", "Encyclopedias in other Germanic languages", "Encyclopedias in French, Occitan & Catalan", "Encyclopedias in Italian, Romanian & related languages", "Encyclopedias in Spanish, Portuguese & Galician", "Encyclopedias in Slavic languages", "Encyclopedias in Scandinavian languages", "Encyclopedias in other languages"],
    "04": ["", "", "", "", "", "", "", "", "", ""],
    "05": ["General serial publications", "Serials in American English", "Serials in English", "Serials in other Germanic languages", "Serials in French, Occitan & Catalan", "Serials in Italian, Romanian & related languages", "Serials in Spanish, Portuguese & Galician", "Serials in Slavic languages", "Serials in Scandinavian languages", "Serials in other languages"],
    "06": ["General organizations & museum science", "Organizations in North America", "Organizations in British Isles", "Organizations in central Europe & Germany", "Organizations in France & Monaco", "Organizations in Italy & adjacent islands", "Organizations in Spain, Andorra, Gibraltar & Portugal", "Organizations in Russia & eastern Europe", "Organizations in other geographic areas", "Museum science"],
    "07": ["News media, journalism & publishing", "Newspapers in North America", "Newspapers in the British Isles", "Newspapers in central Europe & Germany", "Newspapers in France & Monaco", "Newspapers in Italy & adjacent islands", "Newspapers in Spain, Andorra, Gibraltar & Portugal", "Newspapers in Russia & eastern Europe", "Newspapers in Scandinavia", "Newspapers in other geographic areas"],
    "08": ["General collections", "Collections in American English", "Collections in English", "Collections in other Germanic languages", "Collections in French, Occitan & Catalan", "Collections in Italian, Romanian & related languages", "Collections in Spanish, Portuguese & Galician", "Collections in Slavic languages", "Collections in Scandinavian languages", "Collections in other languages"],
    "09": ["Manuscripts & rare books", "Manuscripts", "Block books", "Incunabula", "Printed books", "Books notable for bindings", "Books notable for illustrations", "Books notable for ownership or origin", "Prohibited works, forgeries & hoaxes", "Books notable for format"],

    "10": ["Philosophy", "Theory of philosophy", "Miscellany", "Dictionaries & encyclopedias", "", "Serial publications", "Organizations & management", "Education, research & related topics", "Groups of people", "Historical & collected persons"],
    "11": ["Metaphysics", "Ontology", "", "Cosmology (philosophy of nature)", "Space", "Time", "Change", "Structure", "Force & energy", "Number & quantity"],
    "12": ["Epistemology, causation & humankind", "Epistemology (theory of knowledge)", "Causation", "Determinism & indeterminism", "Teleology", "", "The self", "The unconscious & the subconscious", "Humankind", "Origin & destiny of individual souls"],
    "13": ["Parapsychology & occultism", "Occult methods for achieving well-being", "", "Specific topics in parapsychology & occultism", "", "Dreams & mysteries", "Divinatory graphology", "Physiognomy", "Phrenology", ""],
    "14": ["Specific philosophical schools", "Idealism & related systems", "Critical philosophy", "Bergsonism & intuitionism", "Humanism & related systems", "Sensationalism", "Naturalism & related systems", "Pantheism & related systems", "Dogmatism, eclecticism, liberalism, syncretism & traditionalism", "Other philosophical systems"],
    "15": ["Psychology", "", "Perception, movement, emotions & drives", "Conscious mental processes & intelligence", "Subconscious & altered states & processes", "Differential & developmental psychology", "Comparative psychology", "", "Applied psychology", ""],
    "16": ["Logic", "Induction", "Deduction", "", "", "Fallacies & sources of error", "Syllogisms", "Hypotheses", "Argument & persuasion", "Analogy"],
    "17": ["Ethics (moral philosophy)", "Ethical systems", "Political ethics", "Ethics of family relationships", "Occupational ethics", "Ethics of recreation, leisure, public performances", "Ethics of sex & reproduction", "Ethics of social relations", "Ethics of consumption", "Other ethical norms"],
    "18": ["Ancient, medieval & eastern philosophy", "Eastern philosophy", "Pre-Socratic Greek philosophy", "Socratic & related philosophies", "Platonic philosophy", "Aristotelian philosophy", "Skeptic & Neoplatonic philosophies", "Epicurean philosophy", "Stoic philosophy", "Medieval western philosophy"],
    "19": ["Modern western philosophy", "Philosophy of United States & Canada", "Philosophy of British Isles", "Philosophy of Germany & Austria", "Philosophy of France", "Philosophy of Italy", "Philosophy of Spain & Portugal", "Philosophy of Russia", "Philosophy of Scandinavia & Finland", "Philosophy in other geographic areas"],

    "20": ["Religion", "Religious mythology & social theology", "Doctrines", "Public worship & other practices", "Religious experience, life & practice", "Religious ethics", "Leaders & organization", "Missions & religious education", "Sources", "Sects & reform movements"],
    "21": ["Philosophy & theory of religion", "Concepts of God", "Existence, knowability & attributes of God", "Creation", "Theodicy", "Science & religion", "", "", "Humankind", ""],
    "22": ["The Bible", "Old Testament (Tanakh)", "Historical books of Old Testament", "Poetic books of Old Testament", "Prophetic books of Old Testament", "New Testament", "Gospels & Acts", "Epistles", "Revelation (Apocalypse)", "Apocrypha & pseudepigrapha"],
    "23": ["Christianity", "God", "Jesus Christ & his family", "Humankind", "Salvation & grace", "Spiritual beings", "Eschatology", "", "Creeds, confessions of faith, covenants & catechisms", "Apologetics & polemics"],
    "24": ["Christian moral & devotional theology", "Christian ethics", "Devotional literature", "Evangelistic writings for individuals & families", "", "", "Use of art in Christianity", "Church furnishings & related articles", "Christian experience, practice & life", "Christian observances in family life"],
    "25": ["Local Christian church & religious orders", "Preaching (Homiletics)", "Texts of sermons", "Pastoral office & work", "Parish administration", "Religious congregations & orders", "", "", "", "Pastoral care of families & kinds of persons"],
    "26": ["Christian social & ecclesiastical theology", "Social theology", "Ecclesiology", "Days, times & places of observance", "Public worship", "Sacraments & other rites", "Missions", "Associations for religious work", "Religious education", "Spiritual renewal"],
    "27": ["History of Christianity", "Religious congregations & orders in church history", "Persecutions in general church history", "Doctrinal controversies & heresies", "History of Christianity in Europe", "History of Christianity in Asia", "History of Christianity in Africa", "History of Christianity in North America", "History of Christianity in South America", "History of Christianity in other areas"],
    "28": ["Christian denominations", "Early church & Eastern churches", "Roman Catholic Church", "Anglican churches", "Protestant denominations of Continental origin", "Presbyterian, Reformed & Congregational churches", "Baptist, Restoration movement & Adventist churches", "Methodist & related churches", "", "Other denominations & sects"],
    "29": ["Other religions", "", "Classical religion (Greek & Roman religion)", "Germanic religion", "Religions of Indic origin", "Zoroastrianism (Mazdaism, Parseeism)", "Judaism", "Islam, Babism & Bahai Faith", "", "Religions not provided for elsewhere"],

    "30": ["Social sciences, sociology & anthropology", "Sociology & anthropology", "Social interaction", "Social processes", "Factors affecting social behavior", "Groups of people", "Culture & institutions", "Communities", "", ""],
    "31": ["General statistics", "", "", "", "General statistics of Europe", "General statistics of Asia", "General statistics of Africa", "General statistics of North America", "General statistics of South America", "General statistics of other areas"],
    "32": ["Political science", "Systems of governments & states", "Relation of state to organized groups", "Civil & political rights", "The political process", "International migration & colonization", "Slavery & emancipation", "International relations", "The legislative process", ""],
    "33": ["Economics", "Labor economics", "Financial economics", "Land & energy economics", "Cooperatives", "Socialism & related systems", "Public finance", "International economics", "Production", "Macroeconomics & related topics"],
    "34": ["Law", "Law of nations", "Constitutional & administrative law", "Military, tax, trade & industrial law", "Labor, social, education & cultural law", "Criminal law", "Private law", "Civil procedure & courts", "Laws, regulations & cases", "Law of specific jurisdictions & areas"],
    "35": ["Public administration & military science", "Public administration", "General considerations of public administration", "Specific fields of public administration", "Administration of economy & environment", "Military science", "Foot forces & warfare", "Mounted forces & warfare", "Air & other specialized forces", "Sea forces & warfare"],
    "36": ["Social problems & services; associations", "Social problems & social welfare in general", "Social welfare problems & services", "Other social problems & services", "Criminology", "Penal & related institutions", "Secret associations & societies", "General clubs", "Insurance", "Miscellaneous kinds of associations"],
    "37": ["Education", "Schools & their activities; special education", "Primary education (Elementary education)", "Secondary education", "Adult education", "Curricula", "", "", "Higher education", "Public policy issues in education"],
    "38": ["Commerce, communications & transportation", "Commerce (Trade)", "International commerce (Foreign trade)", "Postal communication", "Communications", "Railroad transportation", "Inland waterway & ferry transportation", "Water, air & space transportation", "Transportation", "Metrology & standardization"],
    "39": ["Customs, etiquette & folklore", "Costume & personal appearance", "Customs of life cycle & domestic life", "Death customs", "General customs", "Etiquette (Manners)", "", "", "Folklore", "Customs of war & diplomacy"],

    "40": ["Language", "Philosophy & theory", "Miscellany", "Dictionaries & encyclopedias", "Special topics", "Serial publications", "Organizations & management", "Education, research & related topics", "Groups of people", "Geographic & persons treatment"],
    "41": ["Linguistics", "Writing systems of standard forms of languages", "Etymology of standard forms of languages", "Dictionaries of standard forms of languages", "Phonology & phonetics", "Grammar of standard forms of languages", "", "Dialectology & historical linguistics", "Standard usage (Prescriptive linguistics)", "Sign languages"],
    "42": ["English & Old English languages", "English writing system & phonology", "English etymology", "English dictionaries", "", "English grammar", "", "English language variations", "Standard English usage", "Old English (Anglo-Saxon)"],
    "43": ["German & related languages", "German writing systems & phonology", "German etymology", "German dictionaries", "", "German grammar", "", "German language variations", "Standard German usage", "Other Germanic languages"],
    "44": ["French & related languages", "French writing systems & phonology", "French etymology", "French dictionaries", "", "French grammar", "", "French language variations", "Standard French usage", "Occitan, Catalan & Franco-Provençal"],
    "45": ["Italian, Romanian & related languages", "Italian writing systems & phonology", "Italian etymology", "Italian dictionaries", "", "Italian grammar", "", "Italian language variations", "Standard Italian usage", "Romanian & related languages"],
    "46": ["Spanish, Portuguese & Galician", "Spanish writing systems & phonology", "Spanish etymology", "Spanish dictionaries", "", "Spanish grammar", "", "Spanish language variations", "Standard Spanish usage", "Portuguese & Galician"],
    "47": ["Latin & Italic languages", "Classical Latin writing & phonology", "Classical Latin etymology", "Classical Latin dictionaries", "", "Classical Latin grammar", "", "Old, postclassical & Vulgar Latin", "Classical Latin usage (Prescriptive linguistics)", "Other Italic languages"],
    "48": ["Classical & modern Greek languages", "Classical Greek writing & phonology", "Classical Greek etymology", "Classical Greek dictionaries", "", "Classical Greek grammar", "", "Preclassical & postclassical Greek", "Classical Greek usage (Prescriptive linguistics)", "Other Hellenic languages"],
    "49": ["Other languages", "East Indo-European & Celtic languages", "Afro-Asiatic languages", "Non-Semitic Afro-Asiatic languages", "Altaic, Uralic, Hyperborean & Dravidian languages", "Languages of East & Southeast Asia", "African languages", "North American native languages", "South American native languages", "Other languages"],

    "50": ["Science", "Philosophy & theory", "Miscellany", "Dictionaries & encyclopedias", "Special topics", "Serial publications", "Organizations & management", "Education, research & related topics", "Groups of people", "History, geography & persons"],
    "51": ["Mathematics", "General principles of mathematics", "Algebra", "Arithmetic", "Topology", "Analysis", "Geometry", "", "Numerical analysis", "Probabilities & applied mathematics"],
    "52": ["Astronomy", "Celestial mechanics", "Techniques, procedures, apparatus & equipment", "Specific celestial bodies & phenomena", "", "Earth (Astronomical geography)", "Mathematical geography", "Celestial navigation", "Ephemerides", "Chronology"],
    "53": ["Physics", "Classical mechanics", "Fluid mechanics", "Pneumatics (Gas mechanics)", "Sound & related vibrations", "Light & related radiation", "Heat", "Electricity & electronics", "Magnetism", "Modern physics"],
    "54": ["Chemistry", "Physical chemistry", "Techniques, procedures, apparatus, equipment & materials", "Analytical chemistry", "", "", "Inorganic chemistry", "Organic chemistry", "Crystallography", "Mineralogy"],
    "55": ["Earth sciences & geology", "Geology, hydrology & meteorology", "Petrology", "Economic geology", "Earth sciences of Europe", "Earth sciences of Asia", "Earth sciences of Africa", "Earth sciences of North America", "Earth sciences of South America", "Earth sciences of other areas"],
    "56": ["Paleontology", "Paleobotany; fossil microorganisms", "Fossil invertebrates", "Fossil marine & seashore invertebrates", "Fossil Mollusca & Molluscoidea", "Fossil arthropods", "Fossil chordates", "Fossil cold-blooded vertebrates", "Fossil birds", "Fossil mammals"],
    "57": ["Biology", "Physiology & related subjects", "Biochemistry", "Specific parts of & physiological systems in animals", "", "Specific parts of & physiological systems in plants", "Genetics & evolution", "Ecology", "Natural history of organisms", "Microorganisms, fungi & algae"],
    "58": ["Plants (Botany)", "Specific topics in natural history of plants", "Plants noted for characteristics & flowers", "Magnoliopsida (Dicotyledons)", "Liliopsida (Monocotyledons)", "Pinophyta (Gymnosperms)", "Seedless plants", "Pteridophyta (Vascular seedless plants)", "Bryophyta", ""],
    "59": ["Animals (Zoology)", "Specific topics in natural history of animals", "Invertebrates", "Marine & seashore invertebrates", "Mollusca & Molluscoidea", "Arthropoda", "Chordata", "Cold-blooded vertebrates", "Aves (Birds)", "Mammalia (Mammals)"],

    "60": ["Technology", "Philosophy & theory", "Miscellany", "Dictionaries & encyclopedias", "Technical drawing & hazardous materials", "Serial publications", "Organizations & management", "Education, research & related topics", "Inventions & patents", "History, geography & persons"],
    "61": ["Medicine & health", "Human anatomy, cytology & histology", "Human physiology", "Personal health & safety", "Forensic medicine; incidence of disease", "Pharmacology & therapeutics", "Diseases", "Surgery & related medical specialties", "Gynecology, obstetrics, pediatrics & geriatrics", ""],
    "62": ["Engineering", "Applied physics", "Mining & related operations", "Military & nautical engineering", "Civil engineering", "Engineering of railroads & roads", "", "Hydraulic engineering", "Sanitary engineering", "Other branches of engineering"],
    "63": ["Agriculture", "Specific techniques; apparatus, equipment & materials", "Plant injuries, diseases & pests", "Field & plantation crops", "Orchards, fruits & forestry", "Garden crops (Horticulture)", "Animal husbandry", "Processing dairy & related products", "Insect culture", "Hunting, fishing & conservation"],
    "64": ["Home & family management", "Food & drink", "Meals & table service", "Housing & household equipment", "Household utilities", "Household furnishings", "Sewing, clothing & personal living", "Management of public households", "Housekeeping", "Child rearing & home care of persons"],
    "65": ["Management & auxiliary services", "Office services", "Processes of written communication", "Shorthand", "", "", "", "Accounting", "General management", "Advertising & public relations"],
    "66": ["Chemical engineering", "Technology of industrial chemicals", "Explosives, fuels & related products", "Beverage technology", "Food technology", "Industrial oils, fats, waxes & gases", "Ceramic & allied technologies", "Cleaning, color & coating technologies", "Other organic products", "Metallurgy"],
    "67": ["Manufacturing", "Metalworking & primary metal products", "Iron, steel & other iron alloys", "Nonferrous metals", "Lumber processing, wood products & cork", "Leather & fur processing", "Pulp & paper technology", "Textiles", "Elastomers & elastomer products", "Other products of specific materials"],
    "68": ["Manufacture for specific uses", "Precision instruments & other devices", "Small forge work (Blacksmithing)", "Hardware & household appliances", "Furnishings & home workshops", "Leather & fur goods & related products", "Printing & related activities", "Clothing & accessories", "Other final products & packaging", ""],
    "69": ["Building & construction", "Building materials", "Auxiliary construction practices", "Specific materials & purposes", "Wood construction", "Roof covering", "Utilities", "Heating, ventilating & air-conditioning", "Detail finishing", ""],

    "70": ["Arts", "Philosophy & theory of fine & decorative arts", "Miscellany of fine & decorative arts", "Dictionaries of fine & decorative arts", "Special topics in fine & decorative arts", "Serial publications of fine & decorative arts", "Organizations & management of fine & decorative arts", "Education, research & related topics", "Galleries, museums & private collections", "History, geography & persons"],
    "71": ["Area planning & landscape architecture", "Area planning (Civic art)", "Landscape architecture (Landscape design)", "Landscape architecture of trafficways", "Water features in landscape architecture", "Woody plants in landscape architecture", "Herbaceous plants in landscape architecture", "Structures in landscape architecture", "Landscape design of cemeteries", "Natural landscapes"],
    "72": ["Architecture", "Architectural materials & structural elements", "Architecture from earliest times to ca. 300", "Architecture from ca. 300 to 1399", "Architecture from 1400", "Public structures", "Buildings for religious purposes", "Buildings for education & research", "Residential & related buildings", "Design & decoration"],
    "73": ["Sculpture, ceramics & metalwork", "Sculptural processes, forms & subjects", "Sculpture from earliest times to ca. 500", "Greek, Etruscan & Roman sculpture", "Sculpture from ca. 500 to 1399", "Sculpture from 1400", "Carving & carvings", "Numismatics & sigillography", "Ceramic arts", "Art metalwork"],
    "74": ["Graphic arts & decorative arts", "Drawing & drawings", "Perspective in drawing", "Drawing & drawings by subject", "", "Decorative arts", "Textile arts", "Interior decoration", "Glass", "Furniture & accessories"],
    "75": ["Painting", "Techniques, procedures, apparatus, equipment & materials", "Color", "Symbolism, allegory, mythology & legend", "Genre paintings", "Religion", "", "Human figures", "Nature, architectural subjects & cityscapes", "History, geographic treatment & biography"],
    "76": ["Printmaking & prints", "Relief processes (Block printing)", "", "Lithographic processes", "Chromolithography & serigraphy", "Metal engraving", "Mezzotinting, aquatinting & related processes", "Etching & drypoint", "", "Prints"],
    "77": ["Photography, computer art, film & video", "Techniques, procedures, apparatus, equipment & materials", "Metallic salt processes", "Pigment processes of printing", "Holography", "Digital photography", "Computer art (Digital art)", "Cinematography & videography", "Specific fields & special kinds of photography", "Photographs"],
    "78": ["Music", "General principles & musical forms", "Vocal music", "Music for single voices", "Instruments & instrumental ensembles", "Ensembles with only one instrument per part", "Keyboard & other instruments", "Stringed instruments (Chordophones)", "Wind instruments (Aerophones)", ""],
    "79": ["Recreational & performing arts", "Public performances", "Stage presentations", "Indoor games & amusements", "Indoor games of skill", "Games of chance", "Athletic & outdoor sports & games", "Aquatic & air sports", "Equestrian sports & animal racing", "Fishing, hunting & shooting"],

    "80": ["Literature, rhetoric & criticism", "Philosophy & theory", "Miscellany", "Dictionaries & encyclopedias", "", "Serial publications", "Organizations & management", "Education, research & related topics", "Rhetoric & collections of literary texts", "History, description & criticism"],
    "81": ["American literature in English", "American poetry in English", "American drama in English", "American fiction in English", "American essays in English", "American speeches in English", "American letters in English", "American humor & satire in English", "American miscellaneous writings", ""],
    "82": ["English & Old English literatures", "English poetry", "English drama", "English fiction", "English essays", "English speeches", "English letters", "English humor & satire", "English miscellaneous writings", "Old English (Anglo-Saxon) literature"],
    "83": ["German & related literatures", "German poetry", "German drama", "German fiction", "German essays", "German speeches", "German letters", "German humor & satire", "German miscellaneous writings", "Other Germanic literatures"],
    "84": ["French & related literatures", "French poetry", "French drama", "French fiction", "French essays", "French speeches", "French letters", "French humor & satire", "French miscellaneous writings", "Occitan, Catalan & Franco-Provençal literatures"],
    "85": ["Italian, Romanian & related literatures", "Italian poetry", "Italian drama", "Italian fiction", "Italian essays", "Italian speeches", "Italian letters", "Italian humor & satire", "Italian miscellaneous writings", "Romanian & related literatures"],
    "86": ["Spanish, Portuguese & Galician literatures", "Spanish poetry", "Spanish drama", "Spanish fiction", "Spanish essays", "Spanish speeches", "Spanish letters", "Spanish humor & satire", "Spanish miscellaneous writings", "Portuguese & Galician literatures"],
    "87": ["Latin & Italic literatures", "Latin poetry", "Latin dramatic poetry & drama", "Latin epic poetry & fiction", "Latin lyric poetry", "Latin speeches", "Latin letters", "Latin humor & satire", "Latin miscellaneous writings", "Literatures of other Italic languages"],
    "88": ["Classical & modern Greek literatures", "Classical Greek poetry", "Classical Greek dramatic poetry & drama", "Classical Greek epic poetry & fiction", "Classical Greek lyric poetry", "Classical Greek speeches", "Classical Greek letters", "Classical Greek humor & satire", "Classical Greek miscellaneous writings", "Modern Greek literature"],
    "89": ["Literatures of other languages", "East Indo-European & Celtic literatures", "Afro-Asiatic literatures", "Non-Semitic Afro-Asiatic literatures", "Altaic, Uralic, Hyperborean & Dravidian literatures", "Literatures of East & Southeast Asia", "African literatures", "Literatures of North American native languages", "Literatures of South American native languages", "Literatures of other languages"],

    "90": ["History", "Philosophy & theory of history", "Miscellany of history", "Dictionaries & encyclopedias of history", "Collected accounts of events", "Serial publications of history", "Organizations & management of history", "Education, research & related topics", "History with respect to groups of people", "World history"],
    "91": ["Geography & travel", "Historical geography", "Atlases, maps & charts", "Geography of & travel in ancient world", "Geography of & travel in Europe", "Geography of & travel in Asia", "Geography of & travel in Africa", "Geography of & travel in North America", "Geography of & travel in South America", "Geography of & travel in other areas"],
    "92": ["Biography, genealogy & insignia", "", "", "", "", "", "", "", "", "Genealogy, names & insignia"],
    "93": ["History of ancient world (to ca. 499)", "China to 420", "Egypt to 640", "Palestine to 70", "India to 647", "Mesopotamia & Iranian Plateau to 637", "Europe north & west of Italy to ca. 499", "Italian Peninsula to 476", "Greece to 323", "Other parts of ancient world"],
    "94": ["History of Europe", "British Isles", "England & Wales", "Germany & neighboring central European countries", "France & Monaco", "Italy, San Marino, Vatican City, Malta", "Spain, Andorra, Gibraltar, Portugal", "Russia & neighboring east European countries", "Scandinavia & Finland", "Other parts of Europe"],
    "95": ["History of Asia", "China & adjacent areas", "Japan", "Arabian Peninsula & adjacent areas", "India & neighboring south Asian countries", "Iran", "Middle East (Near East)", "Siberia (Asiatic Russia)", "Central Asia", "Southeast Asia"],
    "96": ["History of Africa", "Tunisia & Libya", "Egypt, Sudan & South Sudan", "Ethiopia & Eritrea", "Morocco, Ceuta, Melilla & northwest African coast", "Algeria", "West Africa & offshore islands", "Central Africa & offshore islands", "Republic of South Africa & neighboring southern African countries", "South Indian Ocean islands"],
    "97": ["History of North America", "Canada", "Mexico, Central America, West Indies, Bermuda", "United States", "Northeastern United States", "Southeastern United States", "South central United States", "North central United States", "Western United States", "Great Basin & Pacific Slope region"],
    "98": ["History of South America", "Brazil", "Argentina", "Chile", "Bolivia", "Peru", "Colombia & Ecuador", "Venezuela", "Guiana", "Paraguay & Uruguay"],
    "99": ["History of other areas", "", "", "New Zealand", "Australia", "New Guinea & Melanesia", "Polynesia & other Pacific Ocean islands", "Atlantic Ocean islands", "Arctic islands & Antarctica", "Extraterrestrial worlds"],
  };

  // Plain-language blurbs for the ten main classes (shown in the picker and guide).
  const BLURB = {
    "0": "Works about knowledge itself and works that span everything: computing, information, encyclopedias, journalism, libraries.",
    "1": "How we think and why: philosophy, logic, ethics, and psychology.",
    "2": "Beliefs about the divine: the Bible and Christianity, followed by all other world religions.",
    "3": "How people live together: sociology, politics, economics, law, education, customs and folklore.",
    "4": "Languages and linguistics — dictionaries, grammar, and the study of language (not literature).",
    "5": "The natural world: mathematics, astronomy, physics, chemistry, earth sciences, biology, plants and animals.",
    "6": "Applied science: medicine, engineering, agriculture, cooking, business and manufacturing.",
    "7": "Creative and recreational life: architecture, painting, photography, film, music, sports and games.",
    "8": "Literature arranged by language, then by form (poetry, drama, fiction, essays…).",
    "9": "The story of places and people: history, geography, travel and biography.",
  };

  const MAIN = {
    "0": "Computer science, information & general works",
    "1": "Philosophy & psychology",
    "2": "Religion",
    "3": "Social sciences",
    "4": "Language",
    "5": "Science",
    "6": "Technology",
    "7": "Arts & recreation",
    "8": "Literature",
    "9": "History & geography",
  };

  // Literature: the form digit (3rd digit of 810–890) — the same pattern repeats in
  // every language, which makes the 800s easy to assemble by hand.
  const LIT_FORMS = [
    ["1", "Poetry"], ["2", "Drama"], ["3", "Fiction"], ["4", "Essays"], ["5", "Speeches"],
    ["6", "Letters"], ["7", "Humor & satire"], ["8", "Miscellaneous writings"],
  ];

  // Standard subdivisions (-01 to -09) can be added to almost any number.
  const STD_SUBDIVISIONS = [
    ["01", "Philosophy & theory"], ["02", "Miscellany"], ["03", "Dictionaries & encyclopedias"],
    ["04", "Special topics"], ["05", "Serial publications"], ["06", "Organizations & management"],
    ["07", "Education & research"], ["08", "Groups of people"], ["09", "History & geography"],
  ];

  return { SECTIONS: S, MAIN, BLURB, LIT_FORMS, STD_SUBDIVISIONS };
});
